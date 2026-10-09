"""HTTP audio response ownership without changing MIME or request context."""

from collections.abc import Callable, Generator, Iterator
from dataclasses import dataclass, field
from typing import override

import pytest
from flask import Flask, Response, g, has_request_context, request

import controllers.common.audio_response as response_module
from controllers.common.audio_response import audio_binary_response
from graphon.model_runtime.errors.invoke import InvokeBadRequestError
from services.audio_types import AudioOutput

_WAV = b"RIFF\x24\x00\x00\x00WAVE" + b"\x00" * 32


@dataclass
class _Stream(Iterator[bytes]):
    chunks: Iterator[bytes] = field(default_factory=lambda: iter([_WAV, b"remaining"]))
    close_calls: int = 0
    close_error: Exception | None = None

    @override
    def __next__(self) -> bytes:
        return next(self.chunks)

    def close(self) -> None:
        self.close_calls += 1
        if self.close_error is not None:
            raise self.close_error


def test_missing_output_preserves_null_response() -> None:
    assert audio_binary_response(None) is None


@pytest.mark.parametrize("convert", [bytes, bytearray, memoryview])
def test_binary_response_preserves_content_and_detected_mime(
    convert: Callable[[bytes], bytes | bytearray | memoryview],
) -> None:
    response = audio_binary_response(AudioOutput(data=convert(_WAV), mime_type="audio/x-wav"))

    assert response is not None
    assert response.status_code == 200
    assert response.data == _WAV
    assert dict(response.headers) == {"Content-Type": "audio/wav", "Content-Length": str(len(_WAV))}


@pytest.mark.parametrize("consumed_chunks", [0, 1, 2, None])
def test_response_owns_stream_before_consumption_and_after_partial_or_complete_reads(
    consumed_chunks: int | None,
) -> None:
    source = _Stream()
    app = Flask(__name__)
    with app.test_request_context("/audio"):
        response = audio_binary_response(AudioOutput(data=source, mime_type="audio/x-wav"))

    assert response is not None
    assert response.status_code == 200
    assert dict(response.headers) == {"Content-Type": "audio/wav"}
    assert source.close_calls == 0
    try:
        iterator = iter(response.response)
        if consumed_chunks is None:
            assert list(iterator) == [_WAV, b"remaining"]
            assert source.close_calls == 1
        else:
            assert [next(iterator) for _ in range(consumed_chunks)] == [_WAV, b"remaining"][:consumed_chunks]
            assert source.close_calls == 0
    finally:
        response.close()
        response.close()
    assert source.close_calls == 1
    assert not has_request_context()


def test_http_partial_consumption_preserves_and_releases_request_context() -> None:
    closed: list[tuple[str, str]] = []

    def audio() -> Generator[bytes, None, None]:
        try:
            assert request.path == "/audio"
            assert g.audio_marker == "request marker"
            yield _WAV
            assert request.path == "/audio"
            assert g.audio_marker == "request marker"
            yield b"unconsumed"
        finally:
            closed.append((request.path, g.audio_marker))

    source = audio()
    app = Flask(__name__)

    @app.get("/audio")
    def get_audio() -> Response:
        g.audio_marker = "request marker"
        response = audio_binary_response(AudioOutput(data=source, mime_type=None))
        assert response is not None
        return response

    response = app.test_client().get("/audio")
    assert response.status_code == 200
    assert response.headers["Content-Type"] == "audio/wav"
    assert "Content-Length" not in response.headers
    assert next(iter(response.response)) == _WAV
    assert closed == []
    response.close()
    assert closed == [("/audio", "request marker")]
    assert not has_request_context()


@pytest.mark.parametrize("failure", ["mime", "first-chunk"])
@pytest.mark.parametrize("cleanup_fails", [False, True])
def test_inspection_failure_closes_input_exactly_once_and_preserves_error(
    failure: str,
    cleanup_fails: bool,
) -> None:
    error = InvokeBadRequestError("provider disconnected while reading first chunk")

    def broken_chunks() -> Generator[bytes, None, None]:
        raise error
        yield b"unreachable"

    source = _Stream(
        chunks=iter([_WAV]) if failure == "mime" else broken_chunks(),
        close_error=RuntimeError("cleanup failed") if cleanup_fails else None,
    )
    with pytest.raises(InvokeBadRequestError) as caught:
        audio_binary_response(AudioOutput(data=source, mime_type="audio/mpeg"))

    if failure == "first-chunk":
        assert caught.value is error
    else:
        assert "MIME does not match" in str(caught.value)
    assert source.close_calls == 1


def test_missing_request_context_closes_owned_stream() -> None:
    source = _Stream()
    assert not has_request_context()
    with pytest.raises(RuntimeError, match="request context is active"):
        audio_binary_response(AudioOutput(data=source, mime_type=None))
    assert source.close_calls == 1


def test_response_construction_failure_closes_owned_stream(monkeypatch: pytest.MonkeyPatch) -> None:
    source = _Stream()
    error = RuntimeError("HTTP response construction failed")

    def fail_response(*_args: object, **_kwargs: object) -> Response:
        raise error

    monkeypatch.setattr(response_module, "Response", fail_response)
    app = Flask(__name__)
    with app.test_request_context("/audio"):
        with pytest.raises(RuntimeError) as caught:
            audio_binary_response(AudioOutput(data=source, mime_type=None))
    assert caught.value is error
    assert source.close_calls == 1
    assert not has_request_context()


def test_late_provider_error_closes_stream_and_releases_context() -> None:
    error = RuntimeError("provider disconnected after first chunk")

    def broken_chunks() -> Generator[bytes, None, None]:
        yield _WAV
        raise error

    source = _Stream(chunks=broken_chunks())
    app = Flask(__name__)
    with app.test_request_context("/audio"):
        response = audio_binary_response(AudioOutput(data=source, mime_type=None))
    assert response is not None
    iterator = iter(response.response)
    assert next(iterator) == _WAV
    with pytest.raises(RuntimeError) as caught:
        next(iterator)
    response.close()
    assert caught.value is error
    assert source.close_calls == 1
    assert not has_request_context()
