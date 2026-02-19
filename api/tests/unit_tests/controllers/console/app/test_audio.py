from __future__ import annotations

import io
from types import SimpleNamespace

import pytest
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import InternalServerError

from controllers.console.app.audio import ChatMessageAudioApi, ChatMessageTextApi, TextModesApi
from controllers.console.app.error import (
    AppUnavailableError,
    AudioTooLargeError,
    CompletionRequestError,
    NoAudioUploadedError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderNotSupportSpeechToTextError,
    ProviderQuotaExceededError,
    UnsupportedAudioTypeError,
)
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError
from services.audio_service import AudioService
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    ProviderNotSupportTextToSpeechLanageServiceError,
    UnsupportedAudioTypeServiceError,
)


def _unwrap(func):
    bound_self = getattr(func, "__self__", None)
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    if bound_self is not None:
        return func.__get__(bound_self, bound_self.__class__)
    return func


def _file_data():
    return FileStorage(stream=io.BytesIO(b"audio"), filename="audio.wav", content_type="audio/wav")


def test_console_audio_api_success(app, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(AudioService, "transcript_asr", lambda **_kwargs: {"text": "ok"})
    api = ChatMessageAudioApi()
    handler = _unwrap(api.post)
    app_model = SimpleNamespace(id="a1")

    with app.test_request_context("/console/api/apps/app/audio-to-text", method="POST", data={"file": _file_data()}):
        response = handler(app_model=app_model)

    assert response == {"text": "ok"}


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        (AppModelConfigBrokenError(), AppUnavailableError),
        (NoAudioUploadedServiceError(), NoAudioUploadedError),
        (AudioTooLargeServiceError("too big"), AudioTooLargeError),
        (UnsupportedAudioTypeServiceError(), UnsupportedAudioTypeError),
        (ProviderNotSupportSpeechToTextServiceError(), ProviderNotSupportSpeechToTextError),
        (ProviderTokenNotInitError("token"), ProviderNotInitializeError),
        (QuotaExceededError(), ProviderQuotaExceededError),
        (ModelCurrentlyNotSupportError(), ProviderModelCurrentlyNotSupportError),
        (InvokeError("invoke"), CompletionRequestError),
    ],
)
def test_console_audio_api_error_mapping(app, monkeypatch: pytest.MonkeyPatch, exc, expected) -> None:
    monkeypatch.setattr(AudioService, "transcript_asr", lambda **_kwargs: (_ for _ in ()).throw(exc))
    api = ChatMessageAudioApi()
    handler = _unwrap(api.post)
    app_model = SimpleNamespace(id="a1")

    with app.test_request_context("/console/api/apps/app/audio-to-text", method="POST", data={"file": _file_data()}):
        with pytest.raises(expected):
            handler(app_model=app_model)


def test_console_audio_api_unhandled_error(app, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(AudioService, "transcript_asr", lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("boom")))
    api = ChatMessageAudioApi()
    handler = _unwrap(api.post)
    app_model = SimpleNamespace(id="a1")

    with app.test_request_context("/console/api/apps/app/audio-to-text", method="POST", data={"file": _file_data()}):
        with pytest.raises(InternalServerError):
            handler(app_model=app_model)


def test_console_text_api_success(app, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(AudioService, "transcript_tts", lambda **_kwargs: {"audio": "ok"})

    api = ChatMessageTextApi()
    handler = _unwrap(api.post)
    app_model = SimpleNamespace(id="a1")

    with app.test_request_context(
        "/console/api/apps/app/text-to-audio",
        method="POST",
        json={"text": "hello", "voice": "v"},
    ):
        response = handler(app_model=app_model)

    assert response == {"audio": "ok"}


def test_console_text_api_error_mapping(app, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(AudioService, "transcript_tts", lambda **_kwargs: (_ for _ in ()).throw(QuotaExceededError()))

    api = ChatMessageTextApi()
    handler = _unwrap(api.post)
    app_model = SimpleNamespace(id="a1")

    with app.test_request_context(
        "/console/api/apps/app/text-to-audio",
        method="POST",
        json={"text": "hello"},
    ):
        with pytest.raises(ProviderQuotaExceededError):
            handler(app_model=app_model)


def test_console_text_modes_success(app, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(AudioService, "transcript_tts_voices", lambda **_kwargs: ["voice-1"])

    api = TextModesApi()
    handler = _unwrap(api.get)
    app_model = SimpleNamespace(tenant_id="t1")

    with app.test_request_context("/console/api/apps/app/text-to-audio/voices?language=en", method="GET"):
        response = handler(app_model=app_model)

    assert response == ["voice-1"]


def test_console_text_modes_language_error(app, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        AudioService,
        "transcript_tts_voices",
        lambda **_kwargs: (_ for _ in ()).throw(ProviderNotSupportTextToSpeechLanageServiceError()),
    )

    api = TextModesApi()
    handler = _unwrap(api.get)
    app_model = SimpleNamespace(tenant_id="t1")

    with app.test_request_context("/console/api/apps/app/text-to-audio/voices?language=en", method="GET"):
        with pytest.raises(AppUnavailableError):
            handler(app_model=app_model)


def test_audio_to_text_success(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = ChatMessageAudioApi()
    method = _unwrap(api.post)

    response_payload = {"text": "hello"}
    monkeypatch.setattr(AudioService, "transcript_asr", lambda **_kwargs: response_payload)

    app_model = SimpleNamespace(id="app-1")

    data = {"file": (io.BytesIO(b"x"), "sample.wav")}
    with app.test_request_context(
        "/console/api/apps/app-1/audio-to-text",
        method="POST",
        data=data,
        content_type="multipart/form-data",
    ):
        response = method(app_model=app_model)

    assert response == response_payload


def test_audio_to_text_maps_audio_too_large(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = ChatMessageAudioApi()
    method = _unwrap(api.post)

    monkeypatch.setattr(
        AudioService,
        "transcript_asr",
        lambda **_kwargs: (_ for _ in ()).throw(AudioTooLargeServiceError("too large")),
    )

    app_model = SimpleNamespace(id="app-1")

    data = {"file": (io.BytesIO(b"x"), "sample.wav")}
    with app.test_request_context(
        "/console/api/apps/app-1/audio-to-text",
        method="POST",
        data=data,
        content_type="multipart/form-data",
    ):
        with pytest.raises(AudioTooLargeError):
            method(app_model=app_model)


def test_text_to_audio_success(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = ChatMessageTextApi()
    method = _unwrap(api.post)

    monkeypatch.setattr(AudioService, "transcript_tts", lambda **_kwargs: {"audio": "ok"})

    app_model = SimpleNamespace(id="app-1")

    with app.test_request_context(
        "/console/api/apps/app-1/text-to-audio",
        method="POST",
        json={"text": "hello"},
    ):
        response = method(app_model=app_model)

    assert response == {"audio": "ok"}


def test_text_to_audio_voices_success(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = TextModesApi()
    method = _unwrap(api.get)

    monkeypatch.setattr(AudioService, "transcript_tts_voices", lambda **_kwargs: ["voice-1"])

    app_model = SimpleNamespace(tenant_id="tenant-1")

    with app.test_request_context(
        "/console/api/apps/app-1/text-to-audio/voices",
        method="GET",
        query_string={"language": "en-US"},
    ):
        response = method(app_model=app_model)

    assert response == ["voice-1"]


def test_audio_to_text_with_invalid_file(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = ChatMessageAudioApi()
    method = _unwrap(api.post)

    monkeypatch.setattr(AudioService, "transcript_asr", lambda **_kwargs: {"text": "test"})

    app_model = SimpleNamespace(id="app-1")

    data = {"file": (io.BytesIO(b"invalid"), "sample.xyz")}
    with app.test_request_context(
        "/console/api/apps/app-1/audio-to-text",
        method="POST",
        data=data,
        content_type="multipart/form-data",
    ):
        # Should not raise, AudioService is mocked
        response = method(app_model=app_model)
        assert response == {"text": "test"}


def test_text_to_audio_with_language_param(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = ChatMessageTextApi()
    method = _unwrap(api.post)

    monkeypatch.setattr(AudioService, "transcript_tts", lambda **_kwargs: {"audio": "test"})

    app_model = SimpleNamespace(id="app-1")

    with app.test_request_context(
        "/console/api/apps/app-1/text-to-audio",
        method="POST",
        json={"text": "hello", "language": "en-US"},
    ):
        response = method(app_model=app_model)
        assert response == {"audio": "test"}


def test_text_to_audio_voices_with_language_filter(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = TextModesApi()
    method = _unwrap(api.get)

    monkeypatch.setattr(
        AudioService,
        "transcript_tts_voices",
        lambda **_kwargs: [{"id": "voice-1", "name": "Voice 1"}],
    )

    app_model = SimpleNamespace(tenant_id="tenant-1")

    with app.test_request_context(
        "/console/api/apps/app-1/text-to-audio/voices?language=en-US",
        method="GET",
    ):
        response = method(app_model=app_model)
        assert isinstance(response, list)
