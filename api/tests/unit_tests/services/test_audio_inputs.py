"""Validate plain audio uploads before calling the shared provider boundary."""

from io import BytesIO

import pytest

from models import App, AppMode
from services import audio_provider_gateway
from services.audio_service import FILE_SIZE_LIMIT, AudioService
from services.audio_types import AudioAppRef, AudioUpload
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    UnsupportedAudioTypeServiceError,
)


@pytest.mark.parametrize("size", [0, FILE_SIZE_LIMIT, FILE_SIZE_LIMIT + 1])
def test_asr_accepts_empty_and_exact_limit_but_rejects_oversized_upload(
    monkeypatch: pytest.MonkeyPatch, size: int
) -> None:
    app = App(id="app", tenant_id="owner", mode=AppMode.CHAT)
    contents: list[bytes] = []

    def transcribe(*, app: AudioAppRef, content: bytes, end_user: str | None) -> str:
        assert app == AudioAppRef(app_id="app", tenant_id="owner", app_mode="chat")
        assert end_user == "provider-user"
        contents.append(content)
        return " transcript "

    monkeypatch.setattr(audio_provider_gateway, "speech_to_text", transcribe)
    content = b"a" * size
    upload = AudioUpload(stream=BytesIO(content), mime_type="audio/x-m4a")
    if size > FILE_SIZE_LIMIT:
        with pytest.raises(AudioTooLargeServiceError, match="Audio size larger than 30 mb"):
            AudioService.invoke_speech_to_text(app, upload, end_user="provider-user")
        assert contents == []
    else:
        assert AudioService.invoke_speech_to_text(app, upload, end_user="provider-user") == {"text": " transcript "}
        assert contents == [content]


@pytest.mark.parametrize("missing", [False, True])
def test_invalid_upload_does_not_read_stream_or_invoke_provider(monkeypatch: pytest.MonkeyPatch, missing: bool) -> None:
    def unexpected_provider(*, app: AudioAppRef, content: bytes, end_user: str | None) -> str:
        del app, content, end_user
        pytest.fail("Invalid audio reached the provider")

    monkeypatch.setattr(audio_provider_gateway, "speech_to_text", unexpected_provider)
    app = App(id="app", tenant_id="owner", mode=AppMode.CHAT)
    stream = BytesIO(b"unread")
    audio = None if missing else AudioUpload(stream=stream, mime_type="application/octet-stream")
    error = NoAudioUploadedServiceError if missing else UnsupportedAudioTypeServiceError
    with pytest.raises(error):
        AudioService.invoke_speech_to_text(app, audio)
    assert stream.tell() == 0


def test_provider_exception_propagates_without_losing_details(monkeypatch: pytest.MonkeyPatch) -> None:
    error = RuntimeError("provider transcription failed: timeout")

    def transcribe(*, app: AudioAppRef, content: bytes, end_user: str | None) -> str:
        del app, content, end_user
        raise error

    monkeypatch.setattr(audio_provider_gateway, "speech_to_text", transcribe)
    app = App(id="app", tenant_id="owner", mode=AppMode.CHAT)
    audio = AudioUpload(stream=BytesIO(b"input"), mime_type="audio/mp3")
    with pytest.raises(RuntimeError) as caught:
        AudioService.invoke_speech_to_text(app, audio)
    assert caught.value is error
