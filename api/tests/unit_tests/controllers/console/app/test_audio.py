from __future__ import annotations

import io
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID

import pytest
from flask import Flask
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import Forbidden, InternalServerError

from controllers.console.app import audio as audio_module
from controllers.console.app.audio import (
    AgentChatMessageAudioApi,
    ChatMessageAudioApi,
    ChatMessageTextApi,
    TextModesApi,
)
from controllers.console.app.error import (
    AppUnavailableError,
    AudioTooLargeError,
    CompletionRequestError,
    NoAudioUploadedError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderNotSupportSpeechToTextError,
    ProviderQuotaExceededError,
    SpeechToTextDisabledError,
    UnsupportedAudioTypeError,
)
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from graphon.model_runtime.errors.invoke import InvokeError
from models import AppMode
from models.agent import AgentConfigDraftType
from models.agent_config_entities import AgentSoulConfig
from services.agent.composer_service import AgentComposerService
from services.agent.errors import AgentVersionNotFoundError
from services.app_ref_service import MessageRef
from services.audio_service import AudioService
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    ProviderNotSupportTextToSpeechLanageServiceError,
    SpeechToTextDisabledServiceError,
    UnsupportedAudioTypeServiceError,
)


def _file_data():
    return FileStorage(stream=io.BytesIO(b"audio"), filename="audio.wav", content_type="audio/wav")


def test_console_audio_api_success(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(AudioService, "transcript_asr", lambda **_kwargs: {"text": "ok"})
    api = ChatMessageAudioApi()
    handler = unwrap(api.post)
    app_model = SimpleNamespace(id="a1")

    with app.test_request_context("/console/api/apps/app/audio-to-text", method="POST", data={"file": _file_data()}):
        response = handler(api, app_model=app_model)

    assert response == {"text": "ok"}


def test_console_audio_api_accepts_published_agent_apps() -> None:
    assert AppMode.AGENT in audio_module._CONSOLE_AUDIO_TRANSCRIPT_APP_MODES


def test_agent_console_audio_api_uses_agent_draft(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    agent_id = UUID("019ef3d2-b24c-7803-b428-18b5ee8fb853")
    app_model = SimpleNamespace(id="backing-app-1")
    agent_soul = AgentSoulConfig.model_validate({"app_features": {"speech_to_text": {"enabled": True}}})
    calls: dict[str, object] = {}

    def resolve_agent_runtime_app_model(**kwargs):
        calls["resolver"] = kwargs
        return app_model

    def load_agent_soul_for_debug(**kwargs):
        calls["draft"] = kwargs
        return agent_soul

    def transcript_agent_asr(**kwargs):
        calls["asr"] = kwargs
        return {"text": "agent transcript"}

    def enforce_rbac_access(**kwargs):
        calls["rbac"] = kwargs

    monkeypatch.setattr(audio_module, "resolve_agent_runtime_app_model", resolve_agent_runtime_app_model)
    monkeypatch.setattr(audio_module, "enforce_rbac_access", enforce_rbac_access)
    monkeypatch.setattr(AgentComposerService, "load_agent_soul_for_debug", load_agent_soul_for_debug)
    monkeypatch.setattr(AudioService, "transcript_agent_asr", transcript_agent_asr)

    api = AgentChatMessageAudioApi()
    handler = unwrap(api.post)
    session = SimpleNamespace()
    current_user = SimpleNamespace(id="account-1")
    with app.test_request_context(
        f"/console/api/agent/{agent_id}/audio-to-text",
        method="POST",
        data={"file": _file_data(), "draft_type": "debug_build"},
    ):
        response = handler(
            api,
            session=session,
            current_tenant_id="tenant-1",
            current_user=current_user,
            agent_id=agent_id,
        )

    assert response == {"text": "agent transcript"}
    assert calls["resolver"] == {"tenant_id": "tenant-1", "agent_id": agent_id}
    assert calls["rbac"] == {
        "tenant_id": "tenant-1",
        "account_id": "account-1",
        "resource_type": audio_module.RBACResourceScope.APP,
        "scene": audio_module.RBACPermission.APP_TEST_AND_RUN,
        "path_args": {"app_id": "backing-app-1"},
    }
    assert calls["draft"] == {
        "tenant_id": "tenant-1",
        "agent_id": str(agent_id),
        "account_id": "account-1",
        "draft_type": AgentConfigDraftType.DEBUG_BUILD,
        "session": session,
    }
    assert calls["asr"] == {
        "app_model": app_model,
        "agent_soul": agent_soul,
        "file": calls["asr"]["file"],
        "end_user": None,
    }


def test_agent_console_audio_api_defaults_to_normal_draft(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    agent_id = UUID("019ef3d2-b24c-7803-b428-18b5ee8fb853")
    captured: dict[str, object] = {}
    monkeypatch.setattr(
        audio_module,
        "resolve_agent_runtime_app_model",
        lambda **_kwargs: SimpleNamespace(id="backing-app-1"),
    )

    def load_agent_soul_for_debug(**kwargs):
        captured.update(kwargs)
        return AgentSoulConfig.model_validate({"app_features": {"speech_to_text": {"enabled": True}}})

    monkeypatch.setattr(AgentComposerService, "load_agent_soul_for_debug", load_agent_soul_for_debug)
    monkeypatch.setattr(AudioService, "transcript_agent_asr", lambda **_kwargs: {"text": "ok"})

    api = AgentChatMessageAudioApi()
    handler = unwrap(api.post)
    with app.test_request_context(
        f"/console/api/agent/{agent_id}/audio-to-text",
        method="POST",
        data={"file": _file_data()},
    ):
        response = handler(
            api,
            session=SimpleNamespace(),
            current_tenant_id="tenant-1",
            current_user=SimpleNamespace(id="account-1"),
            agent_id=agent_id,
        )

    assert response == {"text": "ok"}
    assert captured["draft_type"] == AgentConfigDraftType.DRAFT


def test_agent_console_audio_api_checks_rbac_with_backing_app_id(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    agent_id = UUID("019ef3d2-b24c-7803-b428-18b5ee8fb853")
    app_model = SimpleNamespace(id="backing-app-1")
    soul_loaded = False

    monkeypatch.setattr(audio_module, "resolve_agent_runtime_app_model", lambda **_kwargs: app_model)

    def deny_access(**kwargs):
        assert kwargs["path_args"] == {"app_id": "backing-app-1"}
        raise Forbidden()

    def load_agent_soul_for_debug(**_kwargs):
        nonlocal soul_loaded
        soul_loaded = True
        return AgentSoulConfig()

    monkeypatch.setattr(audio_module, "enforce_rbac_access", deny_access)
    monkeypatch.setattr(AgentComposerService, "load_agent_soul_for_debug", load_agent_soul_for_debug)

    api = AgentChatMessageAudioApi()
    handler = unwrap(api.post)
    with app.test_request_context(
        f"/console/api/agent/{agent_id}/audio-to-text",
        method="POST",
        data={"file": _file_data()},
    ):
        with pytest.raises(Forbidden):
            handler(
                api,
                session=SimpleNamespace(),
                current_tenant_id="tenant-1",
                current_user=SimpleNamespace(id="account-1"),
                agent_id=agent_id,
            )

    assert soul_loaded is False


def test_agent_console_audio_api_preserves_missing_build_draft_404(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    agent_id = UUID("019ef3d2-b24c-7803-b428-18b5ee8fb853")
    monkeypatch.setattr(
        audio_module,
        "resolve_agent_runtime_app_model",
        lambda **_kwargs: SimpleNamespace(id="backing-app-1"),
    )
    monkeypatch.setattr(
        AgentComposerService,
        "load_agent_soul_for_debug",
        lambda **_kwargs: (_ for _ in ()).throw(AgentVersionNotFoundError()),
    )

    api = AgentChatMessageAudioApi()
    handler = unwrap(api.post)
    with app.test_request_context(
        f"/console/api/agent/{agent_id}/audio-to-text",
        method="POST",
        data={"file": _file_data(), "draft_type": "debug_build"},
    ):
        with pytest.raises(AgentVersionNotFoundError):
            handler(
                api,
                session=SimpleNamespace(),
                current_tenant_id="tenant-1",
                current_user=SimpleNamespace(id="account-1"),
                agent_id=agent_id,
            )


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        (AppModelConfigBrokenError(), AppUnavailableError),
        (NoAudioUploadedServiceError(), NoAudioUploadedError),
        (AudioTooLargeServiceError("too big"), AudioTooLargeError),
        (UnsupportedAudioTypeServiceError(), UnsupportedAudioTypeError),
        (ProviderNotSupportSpeechToTextServiceError(), ProviderNotSupportSpeechToTextError),
        (SpeechToTextDisabledServiceError(), SpeechToTextDisabledError),
        (ProviderTokenNotInitError("token"), ProviderNotInitializeError),
        (QuotaExceededError(), ProviderQuotaExceededError),
        (ModelCurrentlyNotSupportError(), ProviderModelCurrentlyNotSupportError),
        (InvokeError("invoke"), CompletionRequestError),
    ],
)
def test_console_audio_api_error_mapping(app: Flask, monkeypatch: pytest.MonkeyPatch, exc, expected) -> None:
    monkeypatch.setattr(AudioService, "transcript_asr", lambda **_kwargs: (_ for _ in ()).throw(exc))
    api = ChatMessageAudioApi()
    handler = unwrap(api.post)
    app_model = SimpleNamespace(id="a1")

    with app.test_request_context("/console/api/apps/app/audio-to-text", method="POST", data={"file": _file_data()}):
        with pytest.raises(expected):
            handler(api, app_model=app_model)


def test_console_audio_api_unhandled_error(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(AudioService, "transcript_asr", lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("boom")))
    api = ChatMessageAudioApi()
    handler = unwrap(api.post)
    app_model = SimpleNamespace(id="a1")

    with app.test_request_context("/console/api/apps/app/audio-to-text", method="POST", data={"file": _file_data()}):
        with pytest.raises(InternalServerError):
            handler(api, app_model=app_model)


def test_console_text_api_success(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(AudioService, "transcript_tts", lambda **_kwargs: {"audio": "ok"})

    api = ChatMessageTextApi()
    handler = unwrap(api.post)
    app_model = SimpleNamespace(id="a1")

    with app.test_request_context(
        "/console/api/apps/app/text-to-audio",
        method="POST",
        json={"text": "hello", "voice": "v"},
    ):
        response = handler(api, app_model=app_model)

    assert response == {"audio": "ok"}


def test_console_text_api_builds_message_ref(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = ChatMessageTextApi()
    handler = unwrap(api.post)
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    calls = {}

    def fake_transcript_tts(**kwargs):
        calls.update(kwargs)
        return {"audio": "ok"}

    monkeypatch.setattr(AudioService, "transcript_tts", fake_transcript_tts)

    with (
        app.test_request_context(
            "/console/api/apps/app-1/text-to-audio",
            method="POST",
            json={"text": "hello", "message_id": "message-1"},
        ),
        patch("controllers.console.app.audio.current_user", SimpleNamespace(id="account-1")),
    ):
        response = handler(api, app_model=app_model)

    assert response == {"audio": "ok"}
    assert calls["message_ref"] == MessageRef("tenant-1", "app-1", "message-1", account_id="account-1")


def test_console_text_api_error_mapping(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(AudioService, "transcript_tts", lambda **_kwargs: (_ for _ in ()).throw(QuotaExceededError()))

    api = ChatMessageTextApi()
    handler = unwrap(api.post)
    app_model = SimpleNamespace(id="a1")

    with app.test_request_context(
        "/console/api/apps/app/text-to-audio",
        method="POST",
        json={"text": "hello"},
    ):
        with pytest.raises(ProviderQuotaExceededError):
            handler(api, app_model=app_model)


def test_console_text_modes_success(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    expected_voices = [{"name": "Voice 1", "value": "voice-1"}]
    monkeypatch.setattr(AudioService, "transcript_tts_voices", lambda **_kwargs: expected_voices)

    api = TextModesApi()
    handler = unwrap(api.get)
    app_model = SimpleNamespace(tenant_id="t1")

    with app.test_request_context("/console/api/apps/app/text-to-audio/voices?language=en", method="GET"):
        response = handler(api, app_model=app_model)

    assert response == expected_voices


def test_console_text_modes_language_error(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        AudioService,
        "transcript_tts_voices",
        lambda **_kwargs: (_ for _ in ()).throw(ProviderNotSupportTextToSpeechLanageServiceError()),
    )

    api = TextModesApi()
    handler = unwrap(api.get)
    app_model = SimpleNamespace(tenant_id="t1")

    with app.test_request_context("/console/api/apps/app/text-to-audio/voices?language=en", method="GET"):
        with pytest.raises(AppUnavailableError):
            handler(api, app_model=app_model)


def test_audio_to_text_success(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = ChatMessageAudioApi()
    method = unwrap(api.post)

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
        response = method(api, app_model=app_model)

    assert response == response_payload


def test_audio_to_text_maps_audio_too_large(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = ChatMessageAudioApi()
    method = unwrap(api.post)

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
            method(api, app_model=app_model)


def test_text_to_audio_success(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = ChatMessageTextApi()
    method = unwrap(api.post)

    monkeypatch.setattr(AudioService, "transcript_tts", lambda **_kwargs: {"audio": "ok"})

    app_model = SimpleNamespace(id="app-1")

    with app.test_request_context(
        "/console/api/apps/app-1/text-to-audio",
        method="POST",
        json={"text": "hello"},
    ):
        response = method(api, app_model=app_model)

    assert response == {"audio": "ok"}


def test_text_to_audio_voices_success(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = TextModesApi()
    method = unwrap(api.get)

    expected_voices = [{"name": "Voice 1", "value": "voice-1"}]
    monkeypatch.setattr(AudioService, "transcript_tts_voices", lambda **_kwargs: expected_voices)

    app_model = SimpleNamespace(tenant_id="tenant-1")

    with app.test_request_context(
        "/console/api/apps/app-1/text-to-audio/voices",
        method="GET",
        query_string={"language": "en-US"},
    ):
        response = method(api, app_model=app_model)

    assert response == expected_voices


def test_audio_to_text_with_invalid_file(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = ChatMessageAudioApi()
    method = unwrap(api.post)

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
        response = method(api, app_model=app_model)
        assert response == {"text": "test"}


def test_text_to_audio_with_language_param(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = ChatMessageTextApi()
    method = unwrap(api.post)

    monkeypatch.setattr(AudioService, "transcript_tts", lambda **_kwargs: {"audio": "test"})

    app_model = SimpleNamespace(id="app-1")

    with app.test_request_context(
        "/console/api/apps/app-1/text-to-audio",
        method="POST",
        json={"text": "hello", "language": "en-US"},
    ):
        response = method(api, app_model=app_model)
        assert response == {"audio": "test"}


def test_text_to_audio_voices_with_language_filter(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = TextModesApi()
    method = unwrap(api.get)

    monkeypatch.setattr(
        AudioService,
        "transcript_tts_voices",
        lambda **_kwargs: [{"name": "Voice 1", "value": "voice-1"}],
    )

    app_model = SimpleNamespace(tenant_id="tenant-1")

    with app.test_request_context(
        "/console/api/apps/app-1/text-to-audio/voices?language=en-US",
        method="GET",
    ):
        response = method(api, app_model=app_model)
        assert isinstance(response, list)
