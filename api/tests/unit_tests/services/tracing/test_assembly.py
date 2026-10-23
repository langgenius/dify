from datetime import UTC, datetime, timedelta

import pytest
from dify_trace_sdk.events import (
    MessageCompleted,
    ModerationChecked,
    ToolInvoked,
    TraceCorrelation,
    TraceEvent,
    TracePayload,
)
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from models.enums import ConversationFromSource, EndUserType
from models.model import App, AppMode, Conversation, EndUser, Message
from services.tracing.assembly import SourceNotFoundError, SourceNotReadyError, TraceAssembler
from services.tracing.records import MessageTraceInfo, ModerationTraceInfo, ToolTraceInfo

TENANT_ID = "tenant-1"
APP_ID = "app-1"
MESSAGE_ID = "message-1"
CREATED_AT = datetime(2026, 1, 1, 8, 0, 0)


@pytest.fixture
def records(sqlite_session: Session) -> None:
    app = App(
        id=APP_ID,
        tenant_id=TENANT_ID,
        name="Chat app",
        description="",
        mode=AppMode.CHAT,
        enable_site=False,
        enable_api=False,
    )
    end_user = EndUser(
        id="end-user-1",
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        type=EndUserType.SERVICE_API,
        session_id="customer-42",
    )
    conversation = Conversation(
        id="conversation-1",
        app_id=APP_ID,
        app_model_config_id=None,
        model_provider=None,
        override_model_configs=None,
        model_id=None,
        mode=AppMode.CHAT,
        name="Conversation",
        inputs={},
        introduction="",
        system_instruction="",
        system_instruction_tokens=0,
        status="normal",
        invoke_from=InvokeFrom.SERVICE_API,
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
        from_account_id=None,
    )
    message = Message(
        id=MESSAGE_ID,
        app_id=APP_ID,
        conversation_id=conversation.id,
        inputs={},
        query="What is Dify?",
        message=[{"role": "user", "text": "What is Dify?"}],
        message_tokens=12,
        message_unit_price=0,
        message_price_unit=0,
        answer="An LLM app platform.",
        answer_tokens=8,
        answer_unit_price=0,
        answer_price_unit=0,
        provider_response_latency=1.5,
        total_price=0,
        currency="USD",
        invoke_from=InvokeFrom.SERVICE_API,
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
        from_account_id=None,
        app_mode=AppMode.CHAT,
        created_at=CREATED_AT,
        updated_at=CREATED_AT + timedelta(seconds=2),
    )
    sqlite_session.add_all([app, end_user, conversation, message])
    sqlite_session.commit()


def _assembler(sessions: sessionmaker[Session]) -> TraceAssembler:
    return TraceAssembler(sessions, files_url="https://files.example.com", enterprise_details=False)


def _event(payload: TracePayload, *, tenant_id: str = TENANT_ID) -> TraceEvent:
    return TraceEvent(
        event_id="event-1",
        tenant_id=tenant_id,
        app_id=APP_ID,
        user_id="customer-42",
        occurred_at=datetime.now(UTC),
        correlation=TraceCorrelation(
            external_trace_id="caller-trace",
            session_id="session-1",
            parent_workflow_run_id=None,
            parent_node_execution_id=None,
        ),
        payload=payload,
    )


@pytest.mark.usefixtures("records")
def test_message_records_carry_identity_correlation_and_usage(sqlite_session_factory: sessionmaker[Session]) -> None:
    record = _assembler(sqlite_session_factory).assemble(
        _event(MessageCompleted(message_id=MESSAGE_ID, conversation_id="conversation-1"))
    )

    assert isinstance(record, MessageTraceInfo)
    assert record.trace_id == "caller-trace"
    assert (record.message_tokens, record.answer_tokens, record.total_tokens) == (12, 8, 20)
    assert record.inputs == [{"role": "user", "text": "What is Dify?"}]
    assert (record.start_time, record.end_time) == (CREATED_AT, CREATED_AT + timedelta(seconds=2))
    assert record.metadata["trace_event_id"] == "event-1"
    assert record.metadata["trace_session_id"] == "session-1"
    assert record.metadata["end_user_session_id"] == "customer-42"
    assert record.metadata["user_id"] == "end-user-1"
    assert "app_name" in record.metadata
    assert record.metadata["app_name"] == ""


@pytest.mark.usefixtures("records")
def test_events_are_read_only_through_their_own_workspace(sqlite_session_factory: sessionmaker[Session]) -> None:
    with pytest.raises(SourceNotReadyError):
        _assembler(sqlite_session_factory).assemble(
            _event(MessageCompleted(message_id=MESSAGE_ID, conversation_id=None), tenant_id="tenant-2")
        )


@pytest.mark.usefixtures("records")
def test_messages_that_are_not_committed_yet_are_retried(sqlite_session_factory: sessionmaker[Session]) -> None:
    with pytest.raises(SourceNotReadyError):
        _assembler(sqlite_session_factory).assemble(
            _event(MessageCompleted(message_id="message-not-yet-committed", conversation_id=None))
        )


@pytest.mark.usefixtures("records")
def test_moderation_records_keep_the_verdict(sqlite_session_factory: sessionmaker[Session]) -> None:
    payload = ModerationChecked(
        message_id=MESSAGE_ID,
        inputs={"topic": "weather"},
        query="sanitized",
        flagged=True,
        action="overridden",
        preset_response="",
        started_at=CREATED_AT,
        ended_at=CREATED_AT + timedelta(milliseconds=30),
    )

    record = _assembler(sqlite_session_factory).assemble(_event(payload))

    assert isinstance(record, ModerationTraceInfo)
    assert (record.flagged, record.action, record.query) == (True, "overridden", "sanitized")
    assert record.message_id == MESSAGE_ID
    assert record.inputs == {"topic": "weather"}


@pytest.mark.usefixtures("records")
def test_tool_records_take_their_facts_from_the_event(sqlite_session_factory: sessionmaker[Session]) -> None:
    payload = ToolInvoked(
        message_id=MESSAGE_ID,
        tool_name="web_search",
        tool_inputs={"q": "dify"},
        tool_outputs="results",
        tool_config={"provider": "builtin"},
        error=None,
        time_cost=0.25,
        started_at=CREATED_AT,
        ended_at=CREATED_AT + timedelta(milliseconds=250),
    )

    record = _assembler(sqlite_session_factory).assemble(_event(payload))

    assert isinstance(record, ToolTraceInfo)
    assert (record.tool_name, record.tool_outputs, record.time_cost) == ("web_search", "results", 0.25)
    assert record.tool_parameters == {"q": "dify"}
    assert record.metadata["tool_config"] == {"provider": "builtin"}
    assert record.file_url is None


def test_events_without_a_message_id_are_not_found(sqlite_session_factory: sessionmaker[Session]) -> None:
    payload = ModerationChecked(
        message_id=None,
        inputs={},
        query="",
        flagged=False,
        action="direct_output",
        preset_response="",
        started_at=CREATED_AT,
        ended_at=CREATED_AT,
    )

    with pytest.raises(SourceNotFoundError):
        _assembler(sqlite_session_factory).assemble(_event(payload))
