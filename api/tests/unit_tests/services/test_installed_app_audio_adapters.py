import io
import json
from collections.abc import Generator, Iterator, Mapping
from dataclasses import dataclass, replace
from decimal import Decimal
from typing import cast, override
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Connection, event, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

import services.audio_provider_gateway as audio_module
from core.credit_usage import CreditUsageAppType, CreditUsageCreatedBy
from core.model_manager import ModelInstance, ModelManager
from core.plugin.entities.plugin_daemon import TTSAudioChunk
from extensions.ext_database import db
from graphon.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from models import App, AppMode, AppModelConfig, InstalledApp, Message
from models.agent import Agent, AgentConfigSnapshot, AgentScope, AgentSource, AgentStatus
from models.agent_config_entities import AgentSoulConfig
from models.enums import ConversationFromSource, MessageStatus
from models.workflow import Workflow, WorkflowType
from services.agent.errors import AgentVersionNotFoundError
from services.audio_types import AudioOutput, AudioUpload
from services.errors.audio import (
    NoAudioUploadedServiceError,
    SpeechToTextDisabledServiceError,
    UnsupportedAudioTypeServiceError,
)
from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef
from services.installed_app_audio_adapters import InstalledAppAudioRuntime

_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111"


@dataclass
class _Harness:
    runtime: InstalledAppAudioRuntime
    installation: InstalledAppRef
    owner_tenant_id: str
    message_id: str
    config_id: str
    opened_sessions: list[Session]
    closed_sessions: list[Session]
    provider_calls: list[tuple[str, str | None, Mapping[str, object] | None]]
    manager: MagicMock
    model: MagicMock

    def assert_database_closed(self) -> None:
        assert self.opened_sessions
        assert all(session in self.closed_sessions for session in self.opened_sessions)
        assert all(not session.in_transaction() and not session.identity_map for session in self.opened_sessions)

    def tts(
        self, *, text: str | None = " Text input ", voice: str | None = None, message_id: str | None = None
    ) -> AudioOutput | None:
        return self.runtime.transcript_tts(
            installed_app=self.installation, account_id=_ACCOUNT_ID, text=text, voice=voice, message_id=message_id
        )


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> Iterator[_Harness]:
    with sqlite_session_factory.begin() as session:
        app = App(tenant_id=str(uuid4()), name="Audio app", mode=AppMode.CHAT, enable_site=True, enable_api=True)
        session.add(app)
        session.flush()
        config = AppModelConfig(
            app_id=app.id,
            speech_to_text='{"enabled":true}',
            text_to_speech='{"enabled":true,"voice":"configured"}',
        )
        installed = InstalledApp(
            tenant_id=str(uuid4()), app_id=app.id, app_owner_tenant_id=app.tenant_id, position=0, is_pinned=False
        )
        session.add_all([config, installed])
        session.flush()
        app.app_model_config_id = config.id
        message = Message(
            app_id=app.id,
            conversation_id=str(uuid4()),
            query="Question",
            answer=" Message answer ",
            inputs={},
            message={},
            message_unit_price=Decimal(0),
            answer_unit_price=Decimal(0),
            currency="USD",
            from_source=ConversationFromSource.CONSOLE,
            from_account_id=_ACCOUNT_ID,
            from_end_user_id=None,
            status=MessageStatus.NORMAL,
        )
        session.add(message)
        session.flush()

    opened_sessions: list[Session] = []
    closed_sessions: list[Session] = []

    class TrackedSession(Session):
        @override
        def close(self) -> None:
            super().close()
            closed_sessions.append(self)

    factory = sessionmaker(bind=sqlite_session_factory.kw["bind"], class_=TrackedSession, expire_on_commit=True)

    @event.listens_for(factory, "after_begin")
    def capture_read_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        opened_sessions.append(session)

    manager = MagicMock(spec=ModelManager)
    model = MagicMock(spec=ModelInstance)
    manager.get_default_model_instance.return_value = model
    model.get_model_schema.return_value.model_properties = {ModelPropertyKey.AUDIO_TYPE: "wav"}
    model.get_tts_voices.return_value = [{"value": "provider-default"}]
    model.invoke_tts.return_value = b"audio-bytes"
    state = _Harness(
        runtime=InstalledAppAudioRuntime(session_factory=cast(sessionmaker[Session], factory)),
        installation=InstalledAppRef(id=installed.id, tenant_id=installed.tenant_id, app_id=app.id, app_mode="chat"),
        owner_tenant_id=app.tenant_id,
        message_id=message.id,
        config_id=config.id,
        opened_sessions=opened_sessions,
        closed_sessions=closed_sessions,
        provider_calls=[],
        manager=manager,
        model=model,
    )

    def provider(
        *, tenant_id: str, user_id: str | None = None, request_metadata: Mapping[str, object] | None = None
    ) -> ModelManager:
        state.assert_database_closed()
        assert tenant_id == state.owner_tenant_id
        assert user_id is None
        state.provider_calls.append((tenant_id, user_id, request_metadata))
        return manager

    monkeypatch.setattr(audio_module.ModelManager, "for_tenant", provider)
    runtime_app = Flask(__name__)
    runtime_app.config["SQLALCHEMY_DATABASE_URI"] = str(sqlite_session_factory.kw["bind"].url)
    db.init_app(runtime_app)
    with runtime_app.test_request_context():
        try:
            yield state
        finally:
            db.session.remove()
            db.engine.dispose()


@pytest.mark.parametrize("mime_type", ["audio/mp3", "audio/x-m4a"])
def test_asr_preserves_upload_alias_owner_metadata_and_closes_preparation_before_provider(
    harness: _Harness, mime_type: str
) -> None:
    def transcribe(*, file: io.BytesIO) -> str:
        harness.assert_database_closed()
        assert file.read() == b"uploaded-audio"
        assert file.name == "temp.mp3"
        return " transcript "

    harness.model.invoke_speech2text.side_effect = transcribe
    result = harness.runtime.transcript_asr(
        installed_app=harness.installation, audio=AudioUpload(stream=io.BytesIO(b"uploaded-audio"), mime_type=mime_type)
    )
    assert result == {"text": " transcript "}
    assert harness.provider_calls == [
        (
            harness.owner_tenant_id,
            None,
            {"app_type": CreditUsageAppType.CHATBOT, "created_by": CreditUsageCreatedBy.AUDIO},
        )
    ]
    harness.manager.get_default_model_instance.assert_called_once_with(
        tenant_id=harness.owner_tenant_id, model_type=ModelType.SPEECH2TEXT
    )


@pytest.mark.parametrize("missing", [False, True])
def test_asr_upload_errors_preserve_precise_error_before_provider(harness: _Harness, missing: bool) -> None:
    audio = None if missing else AudioUpload(stream=io.BytesIO(b"data"), mime_type="application/octet-stream")
    error = NoAudioUploadedServiceError if missing else UnsupportedAudioTypeServiceError
    with pytest.raises(error):
        harness.runtime.transcript_asr(installed_app=harness.installation, audio=audio)
    harness.assert_database_closed()
    assert harness.provider_calls == []


def test_asr_feature_error_still_precedes_missing_upload(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == harness.config_id)
            .values(speech_to_text='{"enabled":false}')
        )
    with pytest.raises(SpeechToTextDisabledServiceError):
        harness.runtime.transcript_asr(installed_app=harness.installation, audio=None)
    harness.assert_database_closed()
    assert harness.provider_calls == []


@pytest.mark.parametrize("output", [b"audio-bytes", bytearray(b"audio-bytes"), memoryview(b"audio-bytes")])
def test_tts_preserves_raw_output_type_mime_and_owner_metadata(
    harness: _Harness, output: bytes | bytearray | memoryview
) -> None:
    def synthesize(*, content_text: str, voice: str) -> bytes | bytearray | memoryview:
        harness.assert_database_closed()
        assert (content_text, voice) == ("Text input", "configured")
        return output

    harness.model.invoke_tts.side_effect = synthesize
    result = harness.tts()
    assert result is not None
    assert result.data is output
    assert result.mime_type == "audio/wav"
    assert harness.provider_calls == [
        (
            harness.owner_tenant_id,
            None,
            {"app_type": CreditUsageAppType.CHATBOT, "created_by": CreditUsageCreatedBy.AUDIO},
        )
    ]
    harness.manager.get_default_model_instance.assert_called_once_with(
        tenant_id=harness.owner_tenant_id, model_type=ModelType.TTS
    )
    harness.model.get_tts_voices.assert_not_called()


@pytest.mark.parametrize("fail", [False, True])
def test_tts_stream_starts_after_preparation_session_closes_and_preserves_provider_chunks(
    harness: _Harness, fail: bool
) -> None:
    first = TTSAudioChunk(b"RIFF\x24\x00\x00\x00WAVE", "audio/wav")
    failure = RuntimeError("Provider stream interrupted")
    events: list[str] = []

    def chunks() -> Generator[bytes, None, None]:
        harness.assert_database_closed()
        events.append("first chunk")
        yield first
        if fail:
            raise failure
        yield b"remaining audio"

    stream = chunks()
    harness.model.invoke_tts.return_value = stream
    result = harness.tts()
    assert result is not None
    assert result.mime_type == "audio/wav"
    assert result.data is stream
    assert events == []
    assert next(stream) is first
    if fail:
        with pytest.raises(RuntimeError) as error:
            next(stream)
        assert error.value is failure
    else:
        assert list(stream) == [b"remaining audio"]
    assert events == ["first chunk"]


def test_tts_message_takes_priority_over_text_and_keeps_account_scope(harness: _Harness) -> None:
    result = harness.tts(text="Ignored text", message_id=harness.message_id)
    assert result is not None
    harness.model.invoke_tts.assert_called_once_with(content_text="Message answer", voice="configured")


@pytest.mark.parametrize("case", ["malformed", "missing", "other_app", "other_account", "empty_normal", "empty_paused"])
def test_tts_unavailable_message_returns_none_without_falling_back_to_text(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], case: str
) -> None:
    message_id = harness.message_id
    if case == "malformed":
        message_id = "invalid-uuid"
    elif case == "missing":
        message_id = str(uuid4())
    else:
        with sqlite_session_factory.begin() as session:
            message = session.get(Message, message_id)
            assert message is not None
            if case == "other_app":
                message.app_id = str(uuid4())
            elif case == "other_account":
                message.from_account_id = str(uuid4())
            else:
                message.answer = ""
                message.status = MessageStatus.NORMAL if case == "empty_normal" else MessageStatus.PAUSED
    assert harness.tts(text="Do not use as fallback", message_id=message_id) is None
    harness.assert_database_closed()
    assert harness.provider_calls == []


@pytest.mark.parametrize("voice", ["explicit", "", None])
def test_tts_explicit_voice_bypasses_config_and_empty_voice_uses_provider_default(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], voice: str | None
) -> None:
    with sqlite_session_factory.begin() as session:
        config = session.get(AppModelConfig, harness.config_id)
        assert config is not None
        session.delete(config)
    if voice is None:
        with pytest.raises(ValueError, match="AppModelConfig not found"):
            harness.tts(voice=voice)
        assert harness.provider_calls == []
    else:
        assert harness.tts(voice=voice) is not None
        harness.model.invoke_tts.assert_called_once_with(content_text="Text input", voice=voice or "provider-default")
        assert harness.model.get_tts_voices.call_count == (0 if voice else 1)


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.COMPLETION])
@pytest.mark.parametrize("voice", [None, "explicit", ""])
def test_tts_disabled_config_rejects_implicit_voice_and_preserves_explicit_bypass(
    harness: _Harness,
    sqlite_session_factory: sessionmaker[Session],
    mode: AppMode,
    voice: str | None,
) -> None:
    with sqlite_session_factory.begin() as session:
        app = session.get(App, harness.installation.app_id)
        assert app is not None
        app.mode = mode
        config = session.get(AppModelConfig, harness.config_id)
        assert config is not None
        config.text_to_speech = '{"enabled":false,"voice":"disabled-config-voice"}'

    if voice is None:
        with pytest.raises(ValueError, match="^TTS is not enabled$"):
            harness.tts(voice=voice)
        assert harness.provider_calls == []
        harness.model.invoke_tts.assert_not_called()
        harness.model.get_tts_voices.assert_not_called()
    else:
        output = harness.tts(voice=voice)
        assert output is not None
        assert output.data == b"audio-bytes"
        harness.model.invoke_tts.assert_called_once_with(content_text="Text input", voice=voice or "provider-default")
        assert harness.model.get_tts_voices.call_count == (0 if voice else 1)
    harness.assert_database_closed()


@pytest.mark.parametrize("mismatch", ["id", "tenant_id", "app_id", "deleted_app", "deleted_installation"])
def test_both_audio_methods_revalidate_complete_installation_reference(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], mismatch: str
) -> None:
    ref = harness.installation
    if mismatch == "id":
        ref = replace(ref, id=str(uuid4()))
    elif mismatch == "tenant_id":
        ref = replace(ref, tenant_id=str(uuid4()))
    elif mismatch == "app_id":
        ref = replace(ref, app_id=str(uuid4()))
    else:
        with sqlite_session_factory.begin() as session:
            if mismatch == "deleted_app":
                app = session.get(App, ref.app_id)
                assert app is not None
                session.delete(app)
            else:
                installed = session.get(InstalledApp, ref.id)
                assert installed is not None
                session.delete(installed)
    with pytest.raises(InstalledAppNotFoundError):
        harness.runtime.transcript_asr(
            installed_app=ref, audio=AudioUpload(stream=io.BytesIO(b"audio"), mime_type="audio/mp3")
        )
    with pytest.raises(InstalledAppNotFoundError):
        harness.runtime.transcript_tts(
            installed_app=ref, account_id=_ACCOUNT_ID, text="Text", voice="explicit", message_id=None
        )
    assert harness.provider_calls == []
    harness.assert_database_closed()


@pytest.mark.parametrize("published", [False, True])
def test_audio_uses_published_workflow_features_and_voice(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], published: bool
) -> None:
    with sqlite_session_factory.begin() as session:
        app = session.get(App, harness.installation.app_id)
        assert app is not None
        app.mode = AppMode.ADVANCED_CHAT
        workflow = Workflow(
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=WorkflowType.CHAT,
            version="published" if published else Workflow.VERSION_DRAFT,
            graph='{"nodes":[],"edges":[]}',
            _features='{"speech_to_text":{"enabled":true},"text_to_speech":{"enabled":true,"voice":"workflow-voice"}}',
            created_by=_ACCOUNT_ID,
        )
        session.add(workflow)
        session.flush()
        if published:
            app.workflow_id = workflow.id
    if published:
        assert harness.tts() is not None
        harness.model.invoke_tts.assert_called_once_with(content_text="Text input", voice="workflow-voice")
        harness.model.invoke_speech2text.return_value = "Workflow transcription"
        assert harness.runtime.transcript_asr(
            installed_app=harness.installation, audio=AudioUpload(stream=io.BytesIO(b"audio"), mime_type="audio/mp3")
        ) == {"text": "Workflow transcription"}
    else:
        with pytest.raises(ValueError, match="TTS is not enabled"):
            harness.tts()
        with pytest.raises(SpeechToTextDisabledServiceError):
            harness.runtime.transcript_asr(
                installed_app=harness.installation,
                audio=AudioUpload(stream=io.BytesIO(b"audio"), mime_type="audio/mp3"),
            )
        assert harness.provider_calls == []


@pytest.mark.parametrize("enabled", [False, True])
def test_asr_uses_real_published_agent_soul_over_legacy_config(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], enabled: bool
) -> None:
    with sqlite_session_factory.begin() as session:
        app = session.get(App, harness.installation.app_id)
        assert app is not None
        app.mode = AppMode.AGENT
        config = session.get(AppModelConfig, harness.config_id)
        assert config is not None
        config.speech_to_text = json.dumps({"enabled": not enabled})
        agent = Agent(
            tenant_id=app.tenant_id,
            name="Audio Agent",
            app_id=app.id,
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
        )
        session.add(agent)
        session.flush()
        snapshot = AgentConfigSnapshot(
            tenant_id=app.tenant_id,
            agent_id=agent.id,
            version=1,
            config_snapshot=AgentSoulConfig.model_validate({"app_features": {"speech_to_text": {"enabled": enabled}}}),
        )
        session.add(snapshot)
        session.flush()
        agent.active_config_snapshot_id = snapshot.id
    audio = AudioUpload(stream=io.BytesIO(b"audio"), mime_type="audio/mp3")
    if enabled:
        harness.model.invoke_speech2text.return_value = "Agent transcription"
        assert harness.runtime.transcript_asr(installed_app=harness.installation, audio=audio) == {
            "text": "Agent transcription"
        }
        assert harness.provider_calls[0][2] == {
            "app_type": CreditUsageAppType.AGENT_V2,
            "created_by": CreditUsageCreatedBy.AUDIO,
        }
    else:
        with pytest.raises(SpeechToTextDisabledServiceError):
            harness.runtime.transcript_asr(installed_app=harness.installation, audio=audio)
        assert harness.provider_calls == []


@pytest.mark.parametrize("mismatch", ["tenant_id", "app_id", "scope", "source", "status"])
def test_asr_agent_lookup_preserves_all_published_roster_predicates(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], mismatch: str
) -> None:
    with sqlite_session_factory.begin() as session:
        app = session.get(App, harness.installation.app_id)
        assert app is not None
        app.mode = AppMode.AGENT
        agent = Agent(
            tenant_id=app.tenant_id,
            name="Out-of-scope Agent",
            app_id=app.id,
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
        )
        if mismatch == "tenant_id":
            agent.tenant_id = str(uuid4())
        elif mismatch == "app_id":
            agent.app_id = str(uuid4())
        elif mismatch == "scope":
            agent.scope = AgentScope.WORKFLOW_ONLY
        elif mismatch == "source":
            agent.source = AgentSource.ROSTER
        else:
            agent.status = AgentStatus.ARCHIVED
        session.add(agent)
    # An unowned Agent with no snapshot must not block the legacy config fallback.
    harness.model.invoke_speech2text.return_value = "Fallback transcription"
    assert harness.runtime.transcript_asr(
        installed_app=harness.installation,
        audio=AudioUpload(stream=io.BytesIO(b"audio"), mime_type="audio/mp3"),
    ) == {"text": "Fallback transcription"}
    harness.assert_database_closed()


@pytest.mark.parametrize("mismatch", ["unset", "missing", "tenant_id", "agent_id"])
def test_published_agent_snapshot_must_exist_and_match_its_owner(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], mismatch: str
) -> None:
    with sqlite_session_factory.begin() as session:
        app = session.get(App, harness.installation.app_id)
        assert app is not None
        app.mode = AppMode.AGENT
        agent = Agent(
            tenant_id=app.tenant_id,
            name="Owned Agent",
            app_id=app.id,
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
        )
        session.add(agent)
        session.flush()
        if mismatch == "missing":
            agent.active_config_snapshot_id = str(uuid4())
        elif mismatch != "unset":
            snapshot = AgentConfigSnapshot(
                tenant_id=str(uuid4()) if mismatch == "tenant_id" else app.tenant_id,
                agent_id=str(uuid4()) if mismatch == "agent_id" else agent.id,
                version=1,
                config_snapshot=AgentSoulConfig(),
            )
            session.add(snapshot)
            session.flush()
            agent.active_config_snapshot_id = snapshot.id
    with pytest.raises(AgentVersionNotFoundError):
        harness.runtime.transcript_asr(
            installed_app=harness.installation,
            audio=AudioUpload(stream=io.BytesIO(b"audio"), mime_type="audio/mp3"),
        )
    harness.assert_database_closed()
    assert harness.provider_calls == []
