"""Explore audio HTTP contracts with real SQLite admission and an external runtime fake."""

from collections.abc import Generator
from dataclasses import dataclass, field
from io import BytesIO
from typing import Literal
from uuid import uuid4

import pytest
from flask import has_request_context, request
from sqlalchemy import inspect
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.test import TestResponse

import controllers.console.explore.audio as module
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from graphon.model_runtime.errors.invoke import InvokeError
from models import App, AppMode, InstalledApp
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    ProviderNotSupportTextToSpeechServiceError,
    SpeechToTextDisabledServiceError,
    UnsupportedAudioTypeServiceError,
)
from services.installed_app_access_service import InstalledAppRef
from services.installed_app_audio_service import AudioOutput, AudioUpload
from tests.unit_tests.controllers.console.explore.test_installed_app_admission import (
    _assert_json_response,
    _Harness,
    harness,
)

__all__ = ["harness"]

type _Operation = Literal["audio-to-text", "text-to-audio"]
_OPERATIONS: tuple[_Operation, ...] = ("audio-to-text", "text-to-audio")
_WAV = b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00audio-data"


@dataclass
class _Runtime:
    harness: _Harness
    factory: sessionmaker[Session]
    error: Exception | None = None
    transcript: dict[str, str] = field(default_factory=lambda: {"text": "识别完成"})
    output: AudioOutput | None = field(default_factory=lambda: AudioOutput(data=_WAV, mime_type=None))
    asr_calls: list[tuple[InstalledAppRef, bytes | None, str | None]] = field(default_factory=list)
    tts_calls: list[tuple[InstalledAppRef, str, str | None, str | None, str | None]] = field(default_factory=list)

    def transcript_asr(self, *, installed_app: InstalledAppRef, audio: AudioUpload | None) -> dict[str, str]:
        self._assert_reference(installed_app)
        self.asr_calls.append(
            (installed_app, audio.stream.read() if audio is not None else None, audio.mime_type if audio else None)
        )
        if self.error is not None:
            raise self.error
        return self.transcript

    def transcript_tts(
        self,
        *,
        installed_app: InstalledAppRef,
        account_id: str,
        text: str | None,
        voice: str | None,
        message_id: str | None,
    ) -> AudioOutput | None:
        self._assert_reference(installed_app)
        self.tts_calls.append((installed_app, account_id, text, voice, message_id))
        if self.error is not None:
            raise self.error
        return self.output

    def _assert_reference(self, installed_app: InstalledAppRef) -> None:
        assert inspect(installed_app, raiseerr=False) is None
        assert installed_app.id == self.harness.installed_app.id
        assert installed_app.tenant_id == self.harness.installed_app.tenant_id
        assert installed_app.app_id == self.harness.target_app.id
        assert installed_app.tenant_id != self.harness.target_app.tenant_id
        with self.factory() as session:
            installation = session.get(InstalledApp, installed_app.id)
            assert installation is not None
            assert installation.last_used_at is None

    def request(
        self,
        operation: _Operation,
        *,
        body: dict[str, object] | None = None,
        installed_app_id: str | None = None,
        upload: bool = True,
    ) -> TestResponse:
        url = f"/installed-apps/{installed_app_id or self.harness.installed_app.id}/{operation}"
        if operation == "audio-to-text":
            return self.harness.app.test_client().post(
                url,
                data={"file": (BytesIO(_WAV), "recording.wav", "audio/wav")} if upload else {},
                content_type="multipart/form-data",
            )
        return self.harness.app.test_client().post(url, json=body if body is not None else {"text": "你好"})


@dataclass(frozen=True)
class _Services:
    installed_app_audio: _Runtime


@pytest.fixture
def runtime(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> _Runtime:
    state = _Runtime(harness=harness, factory=sqlite_session_factory)
    services = _Services(installed_app_audio=state)
    monkeypatch.setattr(module, "application_services", lambda: services)
    harness.api.add_resource(module.ChatAudioApi, "/installed-apps/<uuid:installed_app_id>/audio-to-text")
    harness.api.add_resource(module.ChatTextApi, "/installed-apps/<uuid:installed_app_id>/text-to-audio")
    return state


def _error(response: TestResponse, *, status: int, code: str, message: str | None = None) -> None:
    assert response.status_code == status
    body = response.get_json()
    assert body["code"] == code
    assert body["status"] == status
    assert isinstance(body["message"], str)
    assert body["message"]
    if message is not None:
        assert body["message"] == message
    assert response.headers["Content-Type"] == "application/json"
    assert int(response.headers["Content-Length"]) == len(response.data)


@pytest.mark.parametrize("text", ["识别完成", ""])
def test_asr_preserves_transcript_and_upload_stream_and_mime(runtime: _Runtime, text: str) -> None:
    runtime.transcript = {"text": text}
    _assert_json_response(runtime.request("audio-to-text"), status=200, body={"text": text})
    assert len(runtime.asr_calls) == 1
    installed_app, data, mime_type = runtime.asr_calls[0]
    assert installed_app.app_mode == "completion"
    assert data == _WAV
    assert mime_type == "audio/wav"
    assert runtime.tts_calls == []


def test_missing_upload_reaches_runtime_and_returns_specific_error(runtime: _Runtime) -> None:
    runtime.error = NoAudioUploadedServiceError()
    _error(runtime.request("audio-to-text", upload=False), status=400, code="no_audio_uploaded")
    assert len(runtime.asr_calls) == 1
    assert runtime.asr_calls[0][1:] == (None, None)


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ({"text": "你好", "voice": "voice-1"}, ("你好", "voice-1", None)),
        (
            {"text": "ignored text", "voice": "", "message_id": "11111111-1111-4111-8111-111111111111"},
            ("ignored text", "", "11111111-1111-4111-8111-111111111111"),
        ),
        ({}, (None, None, None)),
        ({"text": "", "voice": None, "message_id": "malformed", "streaming": False}, ("", None, "malformed")),
        ({"text": None, "streaming": True}, (None, None, None)),
    ],
)
def test_tts_keeps_payload_values_and_authenticated_account(
    runtime: _Runtime, body: dict[str, object], expected: tuple[str | None, str | None, str | None]
) -> None:
    response = runtime.request("text-to-audio", body=body)
    assert response.status_code == 200
    assert response.data == _WAV
    assert response.headers["Content-Type"] == "audio/wav"
    assert len(runtime.tts_calls) == 1
    installed_app, account_id, text, voice, message_id = runtime.tts_calls[0]
    assert installed_app.app_mode == "completion"
    assert account_id == runtime.harness.account.id
    assert (text, voice, message_id) == expected
    assert runtime.asr_calls == []


@pytest.mark.parametrize("data", [_WAV, bytearray(_WAV), memoryview(_WAV)])
def test_tts_binary_carriers_preserve_bytes_and_audio_headers(
    runtime: _Runtime, data: bytes | bytearray | memoryview
) -> None:
    runtime.output = AudioOutput(data=data, mime_type="audio/x-wav")
    response = runtime.request("text-to-audio")
    assert response.status_code == 200
    assert response.data == _WAV
    assert dict(response.headers) == {"Content-Type": "audio/wav", "Content-Length": str(len(_WAV))}


def test_tts_stream_preserves_split_signature_and_all_chunks(runtime: _Runtime) -> None:
    def chunks() -> Generator[bytes]:
        yield _WAV[:2]
        yield b""
        yield _WAV[2:11]
        yield _WAV[11:] + b"00"
        # This tail is consumed after MIME probing and the controller return.
        assert has_request_context()
        assert request.path.endswith("/text-to-audio")
        yield b"tail"

    runtime.output = AudioOutput(data=chunks(), mime_type=None)
    response = runtime.request("text-to-audio")
    assert response.status_code == 200
    assert response.data == _WAV + b"00tail"
    assert dict(response.headers) == {"Content-Type": "audio/wav"}


@pytest.mark.parametrize("consumed_chunks", [0, 1, 2, None])
def test_tts_http_response_closes_retained_provider_stream(runtime: _Runtime, consumed_chunks: int | None) -> None:
    closed: list[bool] = []
    audio_chunks = [_WAV + b"\x00" * 32, b"first-tail", b"second-tail"]
    path = f"/installed-apps/{runtime.harness.installed_app.id}/text-to-audio"

    def chunks() -> Generator[bytes]:
        try:
            for chunk in audio_chunks:
                assert has_request_context()
                assert request.path == path
                yield chunk
        finally:
            closed.append(True)

    source = chunks()
    runtime.output = AudioOutput(data=source, mime_type="audio/x-wav")
    # Dispatch without the test client's initial WSGI read, including the case
    # where the HTTP response is closed before any audio bytes are consumed.
    with runtime.harness.app.test_request_context(path, method="POST", json={"text": "你好"}):
        response = runtime.harness.app.full_dispatch_request()

    assert response.status_code == 200
    assert dict(response.headers) == {"Content-Type": "audio/wav"}
    assert response.is_streamed
    assert closed == []
    try:
        iterator = iter(response.response)
        if consumed_chunks is None:
            assert list(iterator) == audio_chunks
            assert closed == [True]
        else:
            assert [next(iterator) for _ in range(consumed_chunks)] == audio_chunks[:consumed_chunks]
            assert closed == []
    finally:
        response.close()
        response.close()

    assert closed == [True]
    with pytest.raises(StopIteration):
        next(source)


def test_tts_rejects_provider_mime_mismatch_with_specific_completion_error(runtime: _Runtime) -> None:
    runtime.output = AudioOutput(data=_WAV, mime_type="audio/mpeg")
    _error(
        runtime.request("text-to-audio"),
        status=400,
        code="completion_request_error",
        message="TTS provider output MIME does not match its audio bytes: declared audio/mpeg, detected audio/wav",
    )


def test_tts_no_result_remains_json_null(runtime: _Runtime) -> None:
    runtime.output = None
    response = runtime.request("text-to-audio", body={"message_id": "not-a-uuid"})
    assert response.status_code == 200
    assert response.get_json() is None
    assert response.data == b"null\n"
    assert response.headers["Content-Type"] == "application/json"
    assert int(response.headers["Content-Length"]) == len(response.data)
    assert runtime.tts_calls[0][-1] == "not-a-uuid"


@pytest.mark.parametrize("body", [{"text": 123}, {"voice": []}, {"message_id": 123}, {"streaming": "invalid"}])
def test_invalid_tts_body_uses_shared_422_before_runtime(runtime: _Runtime, body: dict[str, object]) -> None:
    _error(runtime.request("text-to-audio", body=body), status=422, code="unprocessable_entity")
    assert runtime.tts_calls == []


@pytest.mark.parametrize("operation", _OPERATIONS)
@pytest.mark.parametrize("mode", list(AppMode))
def test_audio_endpoints_have_no_app_mode_gate(runtime: _Runtime, operation: _Operation, mode: AppMode) -> None:
    with runtime.factory.begin() as session:
        app = session.get(App, runtime.harness.target_app.id)
        assert app is not None
        app.mode = mode
    assert runtime.request(operation).status_code == 200
    calls = runtime.asr_calls if operation == "audio-to-text" else runtime.tts_calls
    assert len(calls) == 1
    assert calls[0][0].app_mode == mode.value


@pytest.mark.parametrize("operation", _OPERATIONS)
@pytest.mark.parametrize("admission", ["missing", "denied", "orphan"])
def test_audio_endpoints_apply_admission_before_reading_or_generating_audio(
    runtime: _Runtime, operation: _Operation, admission: str
) -> None:
    if admission == "denied":
        runtime.harness.state.allowed = False
    elif admission == "orphan":
        with runtime.factory.begin() as session:
            app = session.get(App, runtime.harness.target_app.id)
            assert app is not None
            session.delete(app)
    _error(
        runtime.request(operation, installed_app_id=str(uuid4()) if admission == "missing" else None),
        status=403 if admission == "denied" else 404,
        code="access_denied" if admission == "denied" else "installed_app_not_found",
    )
    assert runtime.asr_calls == runtime.tts_calls == []
    if admission == "orphan":
        assert runtime.harness.state.permission_calls == []
        with runtime.factory() as session:
            assert session.get(InstalledApp, runtime.harness.installed_app.id) is None


@pytest.mark.parametrize("operation", _OPERATIONS)
@pytest.mark.parametrize(
    ("failure", "status", "code", "description"),
    [
        (AppModelConfigBrokenError(), 400, "app_unavailable", None),
        (NoAudioUploadedServiceError(), 400, "no_audio_uploaded", None),
        (AudioTooLargeServiceError("30 MB limit exceeded"), 413, "audio_too_large", "30 MB limit exceeded"),
        (UnsupportedAudioTypeServiceError(), 415, "unsupported_audio_type", None),
        (ProviderNotSupportSpeechToTextServiceError(), 400, "provider_not_support_speech_to_text", None),
        (ProviderTokenNotInitError("Missing credentials"), 400, "provider_not_initialize", "Missing credentials"),
        (QuotaExceededError(), 400, "provider_quota_exceeded", None),
        (ModelCurrentlyNotSupportError(), 400, "model_currently_not_support", None),
        (InvokeError("Provider rejected audio"), 400, "completion_request_error", "Provider rejected audio"),
        (ValueError("Invalid audio arguments"), 400, "invalid_param", "Invalid audio arguments"),
        (RuntimeError("Unexpected provider failure"), 500, "internal_server_error", None),
    ],
)
def test_audio_and_provider_failures_keep_precise_http_contract(
    runtime: _Runtime, operation: _Operation, failure: Exception, status: int, code: str, description: str | None
) -> None:
    runtime.error = failure
    _error(runtime.request(operation), status=status, code=code, message=description)
    assert len(runtime.asr_calls) + len(runtime.tts_calls) == 1


def test_asr_disabled_feature_preserves_400(runtime: _Runtime) -> None:
    runtime.error = SpeechToTextDisabledServiceError()
    _error(runtime.request("audio-to-text"), status=400, code="speech_to_text_disabled")


def test_unsupported_tts_provider_has_specific_error(runtime: _Runtime) -> None:
    runtime.error = ProviderNotSupportTextToSpeechServiceError()
    _error(runtime.request("text-to-audio"), status=400, code="provider_not_support_text_to_speech")
