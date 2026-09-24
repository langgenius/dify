from collections.abc import Generator, Iterator
from types import SimpleNamespace
from typing import cast, override

import pytest

from core.base.tts.audio_mime import (
    get_model_audio_mime_type,
    inspect_audio_stream,
    resolve_audio_mime_type,
    sniff_audio_mime_type,
)
from core.model_manager import ModelInstance
from core.plugin.entities.plugin_daemon import TTSAudioChunk
from graphon.model_runtime.entities.model_entities import ModelPropertyKey
from graphon.model_runtime.errors.invoke import InvokeBadRequestError


def test_inspect_audio_stream_preserves_the_prefix_with_matching_chunk_mime_type() -> None:
    chunks = [b"RIFF\x24\x00\x00\x00", b"WAVEfmt ", b"audio-data"]

    stream, mime_type = inspect_audio_stream(
        iter([TTSAudioChunk(chunk, "audio/wav") for chunk in chunks]), "audio/mpeg"
    )

    assert mime_type == "audio/wav"
    assert list(stream) == chunks


def test_inspect_audio_stream_rejects_mime_magic_mismatch() -> None:
    with pytest.raises(InvokeBadRequestError, match="declared audio/mpeg, detected audio/wav"):
        inspect_audio_stream([TTSAudioChunk(b"RIFF\x24\x00\x00\x00WAVEfmt ", "audio/mpeg")])


def test_inspect_audio_stream_rejects_unsupported_reported_mime_type() -> None:
    with pytest.raises(InvokeBadRequestError, match="unsupported chunk MIME type"):
        inspect_audio_stream([TTSAudioChunk(b"audio", "application/octet-stream")])


def test_resolve_audio_mime_type_falls_back_to_the_declared_model_type() -> None:
    assert resolve_audio_mime_type(b"unrecognised", "audio/ogg") == "audio/ogg"


def test_model_audio_mime_type_normalizes_plugin_metadata() -> None:
    model_instance = SimpleNamespace(
        get_model_schema=lambda: SimpleNamespace(model_properties={ModelPropertyKey.AUDIO_TYPE: "audio/x-wav"})
    )

    assert get_model_audio_mime_type(cast(ModelInstance, model_instance)) == "audio/wav"


@pytest.mark.parametrize(
    ("signature", "mime_type"),
    [
        (b"\xff\xfb" + b"\x00" * 30, "audio/mpeg"),
        (b"\xff\xf1" + b"\x00" * 30, "audio/aac"),
    ],
)
def test_sniff_audio_mime_type_distinguishes_mp3_frames_from_adts(signature: bytes, mime_type: str) -> None:
    assert sniff_audio_mime_type(signature) == mime_type


def test_id3_metadata_is_not_treated_as_proof_of_an_mp3_codec() -> None:
    signature = b"ID3" + b"\x00" * 29

    assert sniff_audio_mime_type(signature) is None
    assert resolve_audio_mime_type(signature, reported_mime_type="audio/aac") == "audio/aac"


class _TrackedStream(Iterator[bytes]):
    def __init__(self, chunks: Iterator[bytes], *, close_error: Exception | None = None) -> None:
        self._chunks: Iterator[bytes] = chunks
        self._close_error: Exception | None = close_error
        self.close_calls: int = 0

    @override
    def __next__(self) -> bytes:
        return next(self._chunks)

    def close(self) -> None:
        self.close_calls += 1
        if self._close_error is not None:
            raise self._close_error


@pytest.mark.parametrize("consumed_chunks", [0, 1, 2, 3])
def test_inspected_stream_closes_source_once_even_before_consumption(consumed_chunks: int) -> None:
    chunks = [b"x" * 32, b"middle", b"last"]
    source = _TrackedStream(iter(chunks))
    stream, mime_type = inspect_audio_stream(source)

    assert mime_type == "audio/mpeg"
    assert [next(stream) for _ in range(consumed_chunks)] == chunks[:consumed_chunks]
    assert source.close_calls == 0
    stream.close()
    stream.close()

    assert source.close_calls == 1
    assert list(stream) == []


@pytest.mark.parametrize("chunks", [[], [b"short"], [b"x" * 32, b"last"]])
def test_exhausting_inspected_stream_closes_source(chunks: list[bytes]) -> None:
    source = _TrackedStream(iter(chunks))
    stream, _ = inspect_audio_stream(source)

    assert list(stream) == chunks
    assert source.close_calls == 1
    stream.close()
    assert source.close_calls == 1


def test_closing_inspected_stream_runs_provider_finally_without_gc() -> None:
    released: list[bool] = []

    def provider() -> Generator[bytes, None, None]:
        try:
            yield b"x" * 32
            yield b"unread"
        finally:
            released.append(True)

    source = provider()
    stream, _ = inspect_audio_stream(source)
    assert released == []

    stream.close()

    assert released == [True]
    assert list(source) == []


@pytest.mark.parametrize("after_prefix", [False, True])
def test_provider_error_closes_source_without_being_replaced_by_cleanup_error(
    after_prefix: bool, caplog: pytest.LogCaptureFixture
) -> None:
    provider_error = RuntimeError("provider interrupted")

    def provider() -> Generator[bytes, None, None]:
        if after_prefix:
            yield b"x" * 32
        raise provider_error

    source = _TrackedStream(provider(), close_error=RuntimeError("cleanup failed"))
    with pytest.raises(RuntimeError) as raised:
        list(inspect_audio_stream(source)[0])

    assert raised.value is provider_error
    assert source.close_calls == 1
    assert "cleanup failed" in caplog.text


@pytest.mark.parametrize(
    "chunks",
    [
        [TTSAudioChunk(b"x", "application/octet-stream")],
        [TTSAudioChunk(b"RIFF\x24\x00\x00\x00WAVEfmt ", "audio/mpeg")],
        [TTSAudioChunk(b"x", "audio/mpeg"), TTSAudioChunk(b"y", "audio/ogg")],
        [b"x" * 32, TTSAudioChunk(b"later", "audio/ogg")],
    ],
)
def test_mime_rejection_closes_provider_during_peek_or_later(chunks: list[bytes]) -> None:
    source = _TrackedStream(iter(chunks))

    with pytest.raises(InvokeBadRequestError):
        list(inspect_audio_stream(source)[0])

    assert source.close_calls == 1


def test_closing_inspected_stream_closes_distinct_iterable_owner_and_iterator() -> None:
    iterator = _TrackedStream(iter([b"x" * 32, b"remaining"]))

    class ProviderResponse:
        def __init__(self) -> None:
            self.close_calls: int = 0

        def __iter__(self) -> Iterator[bytes]:
            return iterator

        def close(self) -> None:
            self.close_calls += 1

    source = ProviderResponse()
    stream, _ = inspect_audio_stream(source)

    stream.close()
    stream.close()

    assert iterator.close_calls == 1
    assert source.close_calls == 1


def test_iterator_creation_failure_closes_provider_response() -> None:
    error = RuntimeError("cannot start reading")

    class ProviderResponse:
        def __init__(self) -> None:
            self.closed: bool = False

        def __iter__(self) -> Iterator[bytes]:
            raise error

        def close(self) -> None:
            self.closed = True

    source = ProviderResponse()
    with pytest.raises(RuntimeError) as raised:
        inspect_audio_stream(source)

    assert raised.value is error
    assert source.closed
