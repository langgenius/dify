from __future__ import annotations

import io
from types import SimpleNamespace

import pytest

from controllers.console.app import audio as audio_module
from controllers.console.app.error import AudioTooLargeError
from services.errors.audio import AudioTooLargeServiceError


def _unwrap(func):
    bound_self = getattr(func, "__self__", None)
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    if bound_self is not None:
        return func.__get__(bound_self, bound_self.__class__)
    return func


def test_audio_to_text_success(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = audio_module.ChatMessageAudioApi()
    method = _unwrap(api.post)

    response_payload = {"text": "hello"}
    monkeypatch.setattr(audio_module.AudioService, "transcript_asr", lambda **_kwargs: response_payload)

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
    api = audio_module.ChatMessageAudioApi()
    method = _unwrap(api.post)

    monkeypatch.setattr(
        audio_module.AudioService,
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
    api = audio_module.ChatMessageTextApi()
    method = _unwrap(api.post)

    monkeypatch.setattr(audio_module.AudioService, "transcript_tts", lambda **_kwargs: {"audio": "ok"})

    app_model = SimpleNamespace(id="app-1")

    with app.test_request_context(
        "/console/api/apps/app-1/text-to-audio",
        method="POST",
        json={"text": "hello"},
    ):
        response = method(app_model=app_model)

    assert response == {"audio": "ok"}


def test_text_to_audio_voices_success(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = audio_module.TextModesApi()
    method = _unwrap(api.get)

    monkeypatch.setattr(audio_module.AudioService, "transcript_tts_voices", lambda **_kwargs: ["voice-1"])

    app_model = SimpleNamespace(tenant_id="tenant-1")

    with app.test_request_context(
        "/console/api/apps/app-1/text-to-audio/voices",
        method="GET",
        query_string={"language": "en-US"},
    ):
        response = method(app_model=app_model)

    assert response == ["voice-1"]


def test_audio_to_text_with_invalid_file(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = audio_module.ChatMessageAudioApi()
    method = _unwrap(api.post)

    monkeypatch.setattr(audio_module.AudioService, "transcript_asr", lambda **_kwargs: {"text": "test"})

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
    api = audio_module.ChatMessageTextApi()
    method = _unwrap(api.post)

    monkeypatch.setattr(audio_module.AudioService, "transcript_tts", lambda **_kwargs: {"audio": "test"})

    app_model = SimpleNamespace(id="app-1")

    with app.test_request_context(
        "/console/api/apps/app-1/text-to-audio",
        method="POST",
        json={"text": "hello", "language": "en-US"},
    ):
        response = method(app_model=app_model)
        assert response == {"audio": "test"}


def test_text_to_audio_voices_with_language_filter(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = audio_module.TextModesApi()
    method = _unwrap(api.get)

    monkeypatch.setattr(
        audio_module.AudioService,
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
