from __future__ import annotations

import io
from collections.abc import Callable, Iterator
from http import HTTPStatus
from inspect import unwrap
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
from flask import Flask
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import InternalServerError
from werkzeug.test import TestResponse

from controllers.console.app import audio as audio_module
from controllers.console.app.audio import (
    ChatMessageAudioApi,
    ChatMessageTextApi,
    TextModesApi,
    TextToSpeechPayload,
    TextToSpeechVoiceQuery,
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
from extensions.ext_application_services import application_services
from graphon.model_runtime.errors.invoke import InvokeError
from models import Account
from models import App as _audio_App
from models import AppMode as _audio_AppMode
from models.agent import Agent, AgentKind, AgentScope, AgentSource, AgentStatus
from models.enums import ConversationFromSource
from models.model import App as _agent_audio_readonly_App
from models.model import AppMode as _agent_audio_readonly_AppMode
from services.agent.agent_app_contracts import AgentAppNotFoundError
from services.app_ref_service import AppRef, MessageRef
from services.audio_service import AudioService
from services.audio_types import AudioAppRef
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    SpeechToTextDisabledServiceError,
    UnsupportedAudioTypeServiceError,
)
from tests.helpers.unit.audio_runtime_fixtures import AudioRuntimeObservations
from tests.helpers.unit.model_factories import make_account, make_app, make_conversation, make_message
from tests.unit_tests.controllers.console.agent.test_api_access import Harness

pytest_plugins = ("tests.unit_tests.controllers.console.agent.test_api_access",)

AGENT_ID = UUID("019ef3d2-b24c-7803-b428-18b5ee8fb853")


def _agent(harness: Harness, scope: AgentScope = AgentScope.WORKFLOW_ONLY) -> Agent:
    workflow_only = scope == AgentScope.WORKFLOW_ONLY
    return Agent(
        id=str(AGENT_ID),
        tenant_id=harness.tenant_id,
        name="Audio agent",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=scope,
        source=AgentSource.WORKFLOW if workflow_only else AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        app_id="parent-app-1" if workflow_only else "runtime-app-1",
        backing_app_id="runtime-app-1" if workflow_only else None,
        workflow_id="workflow-1" if workflow_only else None,
        workflow_node_id="node-1" if workflow_only else None,
        created_by="account-1",
        updated_by="account-1",
    )


def test_agent_asr_rejects_rebound_app_after_admission(sqlite_session: Session, harness: Harness) -> None:
    """Reject a stale APP-scoped authorization before reading the Agent's draft or upload."""
    admitted_app = make_app(
        tenant_id=harness.tenant_id, app_id="runtime-app-1", mode=_agent_audio_readonly_AppMode.AGENT
    )
    replacement_app = make_app(
        tenant_id=harness.tenant_id, app_id="runtime-app-2", mode=_agent_audio_readonly_AppMode.AGENT
    )
    agent = _agent(harness)
    sqlite_session.add_all([agent, admitted_app, replacement_app])
    sqlite_session.commit()
    admitted = AudioAppRef(app_id=admitted_app.id, tenant_id=admitted_app.tenant_id, app_mode=admitted_app.mode.value)
    agent.backing_app_id = replacement_app.id
    sqlite_session.commit()

    with harness.client.application.app_context(), pytest.raises(AgentAppNotFoundError):
        application_services().app_audio.transcript_agent_asr(
            app=admitted, agent_id=str(AGENT_ID), account_id=harness.account_id, build=True, audio=None
        )


def test_agent_tts_keeps_same_account_messages_within_their_app(
    harness: Harness, audio_runtime: AudioRuntimeObservations
) -> None:
    """Return JSON null without resolving a provider for an owned message from a different App."""
    target_agent_id, _ = harness.create_agent()
    source_app = make_app(tenant_id=harness.tenant_id, app_id=str(uuid4()), mode=_audio_AppMode.AGENT)
    source_agent = Agent(
        tenant_id=harness.tenant_id,
        name="Source Agent",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        app_id=source_app.id,
        created_by=harness.account_id,
    )
    conversation = make_conversation(
        conversation_id=None,
        app_id=source_app.id,
        mode=_audio_AppMode.AGENT,
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=harness.account_id,
    )
    message = make_message(
        message_id=None,
        app_id=source_app.id,
        conversation_id=conversation.id,
        query="What did the source Agent say?",
        message=[],
        answer="An answer from the source Agent.",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=harness.account_id,
    )
    with harness.sessions.begin() as session:
        session.add_all([source_app, source_agent, conversation, message])
    payload = {"message_id": message.id, "text": "Fallback text", "voice": "echo"}

    response = harness.client.post(
        f"/console/api/agent/{target_agent_id}/text-to-audio", headers=harness.headers, json=payload
    )

    assert response.status_code == HTTPStatus.OK
    assert response.mimetype == "application/json"
    assert response.get_data().strip() == b"null"
    assert audio_runtime.resolutions == []
    assert audio_runtime.daemon_calls == []

    audio_runtime.tts_result = b"ID3audio"
    source_response = harness.client.post(
        f"/console/api/agent/{source_agent.id}/text-to-audio", headers=harness.headers, json=payload, buffered=True
    )
    assert source_response.status_code == HTTPStatus.OK
    assert source_response.get_data() == b"ID3audio"
    assert audio_runtime.tts_calls == [{"content_text": message.answer, "voice": "echo"}]


class TestAgentAudioReadonlyCases:
    @staticmethod
    @pytest.fixture
    def persistence_events(sqlite_engine: Engine) -> Iterator[list[str]]:
        observed: list[str] = []

        def record_statement(
            _connection: object,
            _cursor: object,
            statement: str,
            _parameters: object,
            _context: object,
            _executemany: bool,
        ) -> None:
            operation = statement.lstrip().split(maxsplit=1)[0].upper()
            if operation in {"INSERT", "UPDATE", "DELETE"}:
                observed.append(operation)

        def record_commit(_session: Session) -> None:
            observed.append("COMMIT")

        event.listen(sqlite_engine, "before_cursor_execute", record_statement)
        event.listen(Session, "before_commit", record_commit)
        try:
            yield observed
        finally:
            event.remove(sqlite_engine, "before_cursor_execute", record_statement)
            event.remove(Session, "before_commit", record_commit)

    @pytest.fixture(params=["voices", "preview"])
    @staticmethod
    def request_audio(
        request: pytest.FixtureRequest, harness: Harness, audio_runtime: AudioRuntimeObservations
    ) -> tuple[Callable[[], TestResponse], AudioRuntimeObservations]:
        """Exercise the mounted voice and TTS endpoints with the provider test transport."""
        path = f"/console/api/agent/{AGENT_ID}/text-to-audio"
        if request.param == "voices":
            audio_runtime.voices = [{"name": "Echo", "value": "echo"}]

            def invoke() -> TestResponse:
                return harness.client.get(f"{path}/voices?language=en-US", headers=harness.headers)

        else:
            audio_runtime.tts_result = b"ID3audio"

            def invoke() -> TestResponse:
                return harness.client.post(path, headers=harness.headers, json={"text": "Preview", "voice": "echo"})

        return invoke, audio_runtime

    @staticmethod
    @pytest.mark.parametrize("scope", [AgentScope.ROSTER, AgentScope.WORKFLOW_ONLY])
    def test_audio_uses_existing_runtime_state_without_writes(
        sqlite_session: Session,
        harness: Harness,
        request_audio: tuple[Callable[[], TestResponse], AudioRuntimeObservations],
        persistence_events: list[str],
        scope: AgentScope,
    ) -> None:
        agent = _agent(harness, scope)
        runtime_app = make_app(
            tenant_id=harness.tenant_id, app_id="runtime-app-1", mode=_agent_audio_readonly_AppMode.AGENT
        )
        sqlite_session.add_all([agent, runtime_app])
        sqlite_session.commit()
        persistence_events.clear()
        invoke, provider = request_audio

        response = invoke()

        assert len(provider.resolutions) == 1
        assert response.status_code == HTTPStatus.OK
        if response.content_type == "audio/mpeg":
            assert response.get_data() == b"ID3audio"
        else:
            assert response.get_json() == [{"name": "Echo", "value": "echo"}]
        response.close()
        assert persistence_events == []

    @staticmethod
    def test_audio_does_not_materialize_a_missing_workflow_backing_app(
        sqlite_session: Session,
        harness: Harness,
        request_audio: tuple[Callable[[], TestResponse], AudioRuntimeObservations],
        persistence_events: list[str],
    ) -> None:
        agent = _agent(harness)
        agent.backing_app_id = None
        parent_app = make_app(
            tenant_id=harness.tenant_id, app_id="parent-app-1", mode=_agent_audio_readonly_AppMode.WORKFLOW
        )
        sqlite_session.add_all([agent, parent_app])
        sqlite_session.commit()
        persistence_events.clear()
        invoke, provider = request_audio

        response = invoke()
        assert response.status_code == HTTPStatus.NOT_FOUND
        assert response.get_json()["code"] == "agent_not_found_error"

        assert provider.resolutions == []
        assert provider.daemon_calls == []
        assert persistence_events == []
        sqlite_session.refresh(agent)
        assert agent.backing_app_id is None
        assert sqlite_session.get(_agent_audio_readonly_App, "runtime-app-1") is None

    @staticmethod
    @pytest.mark.parametrize("foreign_owner", ["agent", "app"])
    def test_audio_scopes_both_agent_and_runtime_app_to_the_current_tenant(
        sqlite_session: Session,
        harness: Harness,
        request_audio: tuple[Callable[[], TestResponse], AudioRuntimeObservations],
        persistence_events: list[str],
        foreign_owner: str,
    ) -> None:
        agent = _agent(harness)
        runtime_app = make_app(
            tenant_id=harness.tenant_id, app_id="runtime-app-1", mode=_agent_audio_readonly_AppMode.AGENT
        )
        if foreign_owner == "agent":
            agent.tenant_id = "tenant-2"
        else:
            runtime_app.tenant_id = "tenant-2"
        sqlite_session.add_all([agent, runtime_app])
        sqlite_session.commit()
        persistence_events.clear()
        invoke, provider = request_audio

        response = invoke()
        assert response.status_code == HTTPStatus.NOT_FOUND
        assert response.get_json()["code"] == "agent_not_found_error"

        assert provider.resolutions == []
        assert provider.daemon_calls == []
        assert persistence_events == []

    @staticmethod
    @pytest.mark.parametrize(
        ("provider_error", "expected_status"),
        [
            (ProviderTokenNotInitError("No TTS model configured"), HTTPStatus.BAD_REQUEST),
            (QuotaExceededError(), HTTPStatus.BAD_REQUEST),
            (ModelCurrentlyNotSupportError(), HTTPStatus.BAD_REQUEST),
            (InvokeError("TTS provider unavailable"), HTTPStatus.BAD_REQUEST),
            (ValueError("Unknown voice"), HTTPStatus.BAD_REQUEST),
            (RuntimeError("Unexpected provider failure"), HTTPStatus.INTERNAL_SERVER_ERROR),
        ],
    )
    def test_provider_failures_preserve_error_contract_and_readonly_state(
        sqlite_session: Session,
        harness: Harness,
        request_audio: tuple[Callable[[], TestResponse], AudioRuntimeObservations],
        persistence_events: list[str],
        provider_error: Exception,
        expected_status: HTTPStatus,
    ) -> None:
        sqlite_session.add_all(
            [
                _agent(harness, AgentScope.ROSTER),
                make_app(tenant_id=harness.tenant_id, app_id="runtime-app-1", mode=_agent_audio_readonly_AppMode.AGENT),
            ]
        )
        sqlite_session.commit()
        persistence_events.clear()
        invoke, provider = request_audio
        provider.lookup_error = provider_error

        assert invoke().status_code == expected_status

        assert len(provider.resolutions) == 1
        assert persistence_events == []


def _file_data() -> FileStorage:
    return FileStorage(stream=io.BytesIO(b"audio"), filename="audio.wav", content_type="audio/wav")


def _app(*, app_id: str = "a1", tenant_id: str = "tenant-1") -> _audio_App:
    return make_app(app_id=app_id, tenant_id=tenant_id, name="Audio app", icon_type=None, max_active_requests=0)


def _account(account_id: str = "account-1") -> Account:
    return make_account(account_id=account_id, name="Audio account", email=f"{account_id}@example.com")


class TestAudioCases:
    @staticmethod
    def test_console_audio_api_success(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(AudioService, "transcript_asr", lambda **_kwargs: {"text": "ok"})
        api = ChatMessageAudioApi()
        handler = unwrap(api.post)
        app_model = _app()

        with app.test_request_context(
            "/console/api/apps/app/audio-to-text", method="POST", data={"file": _file_data()}
        ):
            response = handler(api, app_model=app_model)

        assert response == {"text": "ok"}

    @staticmethod
    def test_console_audio_api_accepts_published_agent_apps() -> None:
        assert _audio_AppMode.AGENT in audio_module._CONSOLE_AUDIO_TRANSCRIPT_APP_MODES

    @staticmethod
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
    def test_console_audio_api_error_mapping(
        app: Flask, monkeypatch: pytest.MonkeyPatch, exc: Exception, expected: type[Exception]
    ) -> None:
        monkeypatch.setattr(AudioService, "transcript_asr", lambda **_kwargs: (_ for _ in ()).throw(exc))
        api = ChatMessageAudioApi()
        handler = unwrap(api.post)
        app_model = _app()

        with app.test_request_context(
            "/console/api/apps/app/audio-to-text", method="POST", data={"file": _file_data()}
        ):
            with pytest.raises(expected):
                handler(api, app_model=app_model)

    @staticmethod
    def test_console_audio_api_unhandled_error(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            AudioService, "transcript_asr", lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("boom"))
        )
        api = ChatMessageAudioApi()
        handler = unwrap(api.post)
        app_model = _app()

        with app.test_request_context(
            "/console/api/apps/app/audio-to-text", method="POST", data={"file": _file_data()}
        ):
            with pytest.raises(InternalServerError):
                handler(api, app_model=app_model)

    @staticmethod
    def test_console_text_api_success(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(AudioService, "transcript_tts", lambda **_kwargs: {"audio": "ok"})

        api = ChatMessageTextApi()
        handler = unwrap(api.post)
        app_model = _app()

        with app.test_request_context(
            "/console/api/apps/app/text-to-audio",
            method="POST",
            json={"text": "hello", "voice": "v"},
        ):
            response = handler(api, TextToSpeechPayload(text="hello"), app_model=app_model)

        assert response == {"audio": "ok"}

    @staticmethod
    def test_console_text_api_builds_message_ref(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        api = ChatMessageTextApi()
        handler = unwrap(api.post)
        app_model = _app(app_id="app-1")
        calls: dict[str, object] = {}

        def fake_transcript_tts(**kwargs: object) -> dict[str, str]:
            calls.update(kwargs)
            return {"audio": "ok"}

        monkeypatch.setattr(AudioService, "transcript_tts", fake_transcript_tts)

        with (
            app.test_request_context(
                "/console/api/apps/app-1/text-to-audio",
                method="POST",
                json={"text": "hello", "message_id": "message-1"},
            ),
            patch("controllers.console.app.audio.current_user", _account()),
        ):
            response = handler(api, TextToSpeechPayload(text="hello", message_id="message-1"), app_model=app_model)

        assert response == {"audio": "ok"}
        assert calls["message_ref"] == MessageRef(AppRef("tenant-1", "app-1"), "message-1", account_id="account-1")

    @staticmethod
    def test_console_text_api_error_mapping(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            AudioService, "transcript_tts", lambda **_kwargs: (_ for _ in ()).throw(QuotaExceededError())
        )

        api = ChatMessageTextApi()
        handler = unwrap(api.post)
        app_model = _app()

        with app.test_request_context(
            "/console/api/apps/app/text-to-audio",
            method="POST",
            json={"text": "hello"},
        ):
            with pytest.raises(ProviderQuotaExceededError):
                handler(api, TextToSpeechPayload(text="hello"), app_model=app_model)

    @staticmethod
    def test_console_text_modes_success(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        expected_voices = [{"name": "Voice 1", "value": "voice-1"}]
        monkeypatch.setattr(AudioService, "transcript_tts_voices", lambda **_kwargs: expected_voices)

        api = TextModesApi()
        handler = unwrap(api.get)
        app_model = _app(tenant_id="t1")

        with app.test_request_context("/console/api/apps/app/text-to-audio/voices?language=en", method="GET"):
            response = handler(api, TextToSpeechVoiceQuery(language="en-US"), app_model=app_model)

        assert response == expected_voices

    @staticmethod
    def test_audio_to_text_success(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        api = ChatMessageAudioApi()
        method = unwrap(api.post)

        response_payload = {"text": "hello"}
        monkeypatch.setattr(AudioService, "transcript_asr", lambda **_kwargs: response_payload)

        app_model = _app(app_id="app-1")

        data = {"file": (io.BytesIO(b"x"), "sample.wav")}
        with app.test_request_context(
            "/console/api/apps/app-1/audio-to-text",
            method="POST",
            data=data,
            content_type="multipart/form-data",
        ):
            response = method(api, app_model=app_model)

        assert response == response_payload

    @staticmethod
    def test_audio_to_text_maps_audio_too_large(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        api = ChatMessageAudioApi()
        method = unwrap(api.post)

        monkeypatch.setattr(
            AudioService,
            "transcript_asr",
            lambda **_kwargs: (_ for _ in ()).throw(AudioTooLargeServiceError("too large")),
        )

        app_model = _app(app_id="app-1")

        data = {"file": (io.BytesIO(b"x"), "sample.wav")}
        with app.test_request_context(
            "/console/api/apps/app-1/audio-to-text",
            method="POST",
            data=data,
            content_type="multipart/form-data",
        ):
            with pytest.raises(AudioTooLargeError):
                method(api, app_model=app_model)

    @staticmethod
    def test_text_to_audio_success(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        api = ChatMessageTextApi()
        method = unwrap(api.post)

        monkeypatch.setattr(AudioService, "transcript_tts", lambda **_kwargs: {"audio": "ok"})

        app_model = _app(app_id="app-1")

        with app.test_request_context(
            "/console/api/apps/app-1/text-to-audio",
            method="POST",
            json={"text": "hello"},
        ):
            response = method(api, TextToSpeechPayload(text="hello"), app_model=app_model)

        assert response == {"audio": "ok"}

    @staticmethod
    def test_text_to_audio_voices_success(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        api = TextModesApi()
        method = unwrap(api.get)

        expected_voices = [{"name": "Voice 1", "value": "voice-1"}]
        monkeypatch.setattr(AudioService, "transcript_tts_voices", lambda **_kwargs: expected_voices)

        app_model = _app()

        with app.test_request_context(
            "/console/api/apps/app-1/text-to-audio/voices",
            method="GET",
            query_string={"language": "en-US"},
        ):
            response = method(api, TextToSpeechVoiceQuery(language="en-US"), app_model=app_model)

        assert response == expected_voices

    @staticmethod
    def test_audio_to_text_with_invalid_file(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        api = ChatMessageAudioApi()
        method = unwrap(api.post)

        monkeypatch.setattr(AudioService, "transcript_asr", lambda **_kwargs: {"text": "test"})

        app_model = _app(app_id="app-1")

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

    @staticmethod
    def test_text_to_audio_with_language_param(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        api = ChatMessageTextApi()
        method = unwrap(api.post)

        monkeypatch.setattr(AudioService, "transcript_tts", lambda **_kwargs: {"audio": "test"})

        app_model = _app(app_id="app-1")

        with app.test_request_context(
            "/console/api/apps/app-1/text-to-audio",
            method="POST",
            json={"text": "hello", "language": "en-US"},
        ):
            response = method(api, TextToSpeechPayload(text="hello"), app_model=app_model)
            assert response == {"audio": "test"}

    @staticmethod
    def test_text_to_audio_voices_with_language_filter(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        api = TextModesApi()
        method = unwrap(api.get)

        monkeypatch.setattr(
            AudioService,
            "transcript_tts_voices",
            lambda **_kwargs: [{"name": "Voice 1", "value": "voice-1"}],
        )

        app_model = _app()

        with app.test_request_context(
            "/console/api/apps/app-1/text-to-audio/voices?language=en-US",
            method="GET",
        ):
            response = method(api, TextToSpeechVoiceQuery(language="en-US"), app_model=app_model)
            assert isinstance(response, list)
