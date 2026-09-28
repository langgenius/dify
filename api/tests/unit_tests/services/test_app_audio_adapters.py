import io
import json
from collections.abc import Iterator
from dataclasses import dataclass, field, replace
from decimal import Decimal
from typing import cast, override
from uuid import uuid4

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from models import App, AppMode, AppModelConfig, Message
from models.agent import Agent, AgentConfigSnapshot, AgentScope, AgentSource
from models.agent_config_entities import AgentSoulConfig
from models.enums import ConversationFromSource, MessageStatus
from models.model import AccountTrialAppRecord
from models.workflow import Workflow, WorkflowType
from services import audio_provider_gateway
from services.app_audio_adapters import AppAudioRuntime
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.audio_types import AudioAppRef, AudioOutput, AudioUpload
from services.errors.audio import NoAudioUploadedServiceError, SpeechToTextDisabledServiceError

_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111"


@dataclass
class _Harness:
    runtime: AppAudioRuntime
    app: AudioAppRef
    config_id: str
    message_id: str
    engine: Engine
    closed_sessions: list[Session]
    asr_calls: list[tuple[AudioAppRef, bytes, str | None]] = field(default_factory=list)
    tts_calls: list[tuple[AudioAppRef, str, str | None, str | None]] = field(default_factory=list)
    output: AudioOutput = field(default_factory=lambda: AudioOutput(data=b"audio", mime_type="audio/wav"))

    def assert_database_closed(self) -> None:
        assert self.closed_sessions
        assert all(not session.in_transaction() and not session.identity_map for session in self.closed_sessions)
        assert cast(QueuePool, self.engine.pool).checkedout() == 0

    def tts(
        self, *, text: str | None = " Text input ", voice: str | None = None, message_id: str | None = None
    ) -> AudioOutput | None:
        return self.runtime.transcript_tts(
            app=self.app, account_id=_ACCOUNT_ID, text=text, voice=voice, message_id=message_id
        )

    def asr(self) -> dict[str, str]:
        return self.runtime.transcript_asr(
            app=self.app, audio=AudioUpload(stream=io.BytesIO(b"uploaded"), mime_type="audio/mp3")
        )


@pytest.fixture
def harness(
    sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> _Harness:
    with sqlite_session_factory.begin() as session:
        app = App(tenant_id=str(uuid4()), name="Audio app", mode=AppMode.CHAT, enable_site=True, enable_api=False)
        session.add(app)
        session.flush()
        config = AppModelConfig(
            app_id=app.id,
            speech_to_text='{"enabled":true}',
            text_to_speech='{"enabled":true,"voice":"configured"}',
        )
        session.add(config)
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
            status=MessageStatus.NORMAL,
        )
        session.add(message)
        session.flush()

    closed_sessions: list[Session] = []

    class TrackedSession(Session):
        @override
        def commit(self) -> None:
            pytest.fail("Audio preparation must not commit")

        @override
        def close(self) -> None:
            super().close()
            closed_sessions.append(self)

    factory = sessionmaker(bind=sqlite_engine, class_=TrackedSession, expire_on_commit=True)
    state = _Harness(
        runtime=AppAudioRuntime(session_factory=cast(sessionmaker[Session], factory)),
        app=AudioAppRef(app_id=app.id, tenant_id=app.tenant_id, app_mode=app.mode),
        config_id=config.id,
        message_id=message.id,
        engine=sqlite_engine,
        closed_sessions=closed_sessions,
    )

    def transcribe(*, app: AudioAppRef, content: bytes, end_user: str | None) -> str:
        state.assert_database_closed()
        state.asr_calls.append((app, content, end_user))
        return " transcript "

    def synthesize(*, app: AudioAppRef, text: str, voice: str | None, end_user: str | None) -> AudioOutput:
        state.assert_database_closed()
        state.tts_calls.append((app, text, voice, end_user))
        return state.output

    monkeypatch.setattr(audio_provider_gateway, "speech_to_text", transcribe)
    monkeypatch.setattr(audio_provider_gateway, "text_to_speech", synthesize)
    return state


def test_asr_reads_upload_and_invokes_provider_after_releasing_session(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session]
) -> None:
    class CheckedUpload(io.BytesIO):
        @override
        def read(self, size: int | None = -1) -> bytes:
            harness.assert_database_closed()
            return super().read(size)

    assert harness.runtime.transcript_asr(
        app=harness.app,
        audio=AudioUpload(stream=CheckedUpload(b"uploaded"), mime_type="audio/x-m4a"),
    ) == {"text": " transcript "}
    assert harness.asr_calls == [
        (AudioAppRef(harness.app.app_id, harness.app.tenant_id, harness.app.app_mode), b"uploaded", None)
    ]
    assert len(harness.closed_sessions) == 1
    with sqlite_session_factory() as session:
        assert session.scalar(select(AccountTrialAppRecord)) is None


@pytest.mark.parametrize("disabled", [False, True])
def test_asr_feature_error_precedes_missing_upload(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], disabled: bool
) -> None:
    with sqlite_session_factory.begin() as session:
        config = session.get(AppModelConfig, harness.config_id)
        assert config is not None
        config.speech_to_text = json.dumps({"enabled": not disabled})
    error = SpeechToTextDisabledServiceError if disabled else NoAudioUploadedServiceError
    with pytest.raises(error):
        harness.runtime.transcript_asr(app=harness.app, audio=None)
    harness.assert_database_closed()
    assert harness.asr_calls == []


def test_tts_prioritizes_owned_message_and_preserves_provider_output(harness: _Harness) -> None:
    assert harness.tts(message_id=harness.message_id) is harness.output
    assert harness.tts_calls == [
        (
            AudioAppRef(harness.app.app_id, harness.app.tenant_id, harness.app.app_mode),
            "Message answer",
            "configured",
            None,
        )
    ]
    assert len(harness.closed_sessions) == 1


@pytest.mark.parametrize("case", ["malformed", "missing", "app", "account", "empty-normal", "empty-paused"])
def test_tts_unavailable_message_does_not_fall_back_to_text_or_invoke_provider(
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
            if case == "app":
                message.app_id = str(uuid4())
            elif case == "account":
                message.from_account_id = str(uuid4())
            else:
                message.answer = ""
                message.status = MessageStatus.NORMAL if case == "empty-normal" else MessageStatus.PAUSED
    assert harness.tts(message_id=message_id) is None
    assert harness.tts_calls == []
    harness.assert_database_closed()


@pytest.mark.parametrize("case", ["id", "missing", "tenant", "mode"])
def test_both_methods_revalidate_app_owner_and_mode_before_audio_work(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], case: str
) -> None:
    with sqlite_session_factory.begin() as session:
        app = session.get(App, harness.app.app_id)
        assert app is not None
        if case == "id":
            # Leave a valid app in the database to lock down the app_id predicate.
            harness.app = replace(harness.app, app_id=str(uuid4()))
        elif case == "missing":
            session.delete(app)
        elif case == "tenant":
            app.tenant_id = str(uuid4())
        else:
            app.mode = AppMode.COMPLETION
    with pytest.raises(AppDefinitionUnavailableError):
        harness.asr()
    with pytest.raises(AppDefinitionUnavailableError):
        harness.tts(voice="explicit")
    assert harness.asr_calls == harness.tts_calls == []
    harness.assert_database_closed()


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.COMPLETION])
@pytest.mark.parametrize("voice", [None, "explicit", ""])
def test_tts_disabled_config_rejects_implicit_voice_and_keeps_explicit_bypass(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], mode: AppMode, voice: str | None
) -> None:
    with sqlite_session_factory.begin() as session:
        app = session.get(App, harness.app.app_id)
        config = session.get(AppModelConfig, harness.config_id)
        assert app is not None
        assert config is not None
        app.mode = mode
        config.text_to_speech = '{"enabled":false,"voice":"disabled"}'
    harness.app = replace(harness.app, app_mode=mode)
    if voice is None:
        with pytest.raises(ValueError, match="^TTS is not enabled$"):
            harness.tts(voice=voice)
        assert harness.tts_calls == []
    else:
        assert harness.tts(voice=voice) is harness.output
        assert harness.tts_calls[0][1:] == ("Text input", voice, None)
    harness.assert_database_closed()


@pytest.mark.parametrize("published", [False, True])
def test_both_methods_use_published_workflow_not_draft(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], published: bool
) -> None:
    with sqlite_session_factory.begin() as session:
        app = session.get(App, harness.app.app_id)
        assert app is not None
        app.mode = AppMode.ADVANCED_CHAT
        workflow = Workflow(
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=WorkflowType.CHAT,
            version="published" if published else Workflow.VERSION_DRAFT,
            graph='{"nodes":[],"edges":[]}',
            _features='{"speech_to_text":{"enabled":true},"text_to_speech":{"enabled":true,"voice":"workflow"}}',
            created_by=_ACCOUNT_ID,
        )
        session.add(workflow)
        session.flush()
        if published:
            app.workflow_id = workflow.id
    harness.app = replace(harness.app, app_mode=AppMode.ADVANCED_CHAT)
    if published:
        assert harness.tts() is harness.output
        assert harness.tts_calls[0][1:] == ("Text input", "workflow", None)
        assert harness.asr() == {"text": " transcript "}
    else:
        with pytest.raises(ValueError, match="^TTS is not enabled$"):
            harness.tts()
        with pytest.raises(SpeechToTextDisabledServiceError):
            harness.asr()
        assert harness.asr_calls == harness.tts_calls == []
    harness.assert_database_closed()


@pytest.mark.parametrize("enabled", [False, True])
def test_asr_uses_published_agent_soul_over_model_config(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], enabled: bool
) -> None:
    with sqlite_session_factory.begin() as session:
        app = session.get(App, harness.app.app_id)
        config = session.get(AppModelConfig, harness.config_id)
        assert app is not None
        assert config is not None
        app.mode = AppMode.AGENT
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
    harness.app = replace(harness.app, app_mode=AppMode.AGENT)
    if enabled:
        assert harness.asr() == {"text": " transcript "}
        assert harness.asr_calls[0][0].app_mode == AppMode.AGENT
    else:
        with pytest.raises(SpeechToTextDisabledServiceError):
            harness.asr()
        assert harness.asr_calls == []
    harness.assert_database_closed()


def test_tts_stream_is_unconsumed_and_sessions_stay_closed_during_iteration(harness: _Harness) -> None:
    chunks_read: list[bytes] = []

    def stream() -> Iterator[bytes]:
        harness.assert_database_closed()
        chunks_read.append(b"first")
        yield b"first"
        yield b"second"

    chunks = stream()
    harness.output = AudioOutput(data=chunks, mime_type="audio/wav")
    assert harness.tts() is harness.output
    assert chunks_read == []
    assert list(chunks) == [b"first", b"second"]
    assert chunks_read == [b"first"]
