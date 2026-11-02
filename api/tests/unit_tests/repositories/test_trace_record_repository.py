import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from dify_trace_sdk.events import (
    MessageCompleted,
    ModerationChecked,
    ToolInvoked,
    TraceCorrelation,
    TraceEvent,
    TracePayload,
    WorkflowRunCompleted,
)
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from extensions.logstore.aliyun_logstore import AliyunLogStore
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from models.enums import (
    ConversationFromSource,
    ConversationStatus,
    CreatorUserRole,
    EndUserType,
    InvokeFrom,
    WorkflowRunTriggeredFrom,
)
from models.model import App, AppMode, Conversation, EndUser, Message
from models.workflow import (
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowType,
)
from repositories.factory import DifyAPIRepositoryFactory
from repositories.trace_record_repository import TraceRecordRepository
from services.tracing.errors import SourceNotFoundError, SourceNotReadyError, TracingStoreUnavailableError
from services.tracing.records import (
    MessageTraceInfo,
    ModerationTraceInfo,
    ToolTraceInfo,
    TraceMessage,
    WorkflowTraceInfo,
)
from tests.helpers.unit.config_override import apply_config_overrides

TENANT_ID = "tenant-1"
APP_ID = "app-1"
MESSAGE_ID = "message-1"
CREATED_AT = datetime(2026, 1, 1, 8, 0, 0)
WORKFLOW_APP_ID = "workflow-app"
OUTER_RUN_ID = "outer-workflow-run"
TOOL_NODE_ID = "outer-tool-node"


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
        _inputs={},
        introduction="",
        system_instruction="",
        system_instruction_tokens=0,
        status=ConversationStatus.NORMAL,
        invoke_from=InvokeFrom.SERVICE_API,
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
        from_account_id=None,
    )
    message = Message(
        id=MESSAGE_ID,
        app_id=APP_ID,
        conversation_id=conversation.id,
        _inputs={},
        query="What is Dify?",
        message=[{"role": "user", "text": "What is Dify?"}],
        message_tokens=12,
        message_unit_price=Decimal(0),
        message_price_unit=Decimal(0),
        answer="An LLM app platform.",
        answer_tokens=8,
        answer_unit_price=Decimal(0),
        answer_price_unit=Decimal(0),
        provider_response_latency=1.5,
        total_price=Decimal(0),
        currency="USD",
        invoke_from=InvokeFrom.SERVICE_API,
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
        from_account_id=None,
        app_mode=AppMode.CHAT,
    )
    message.created_at = CREATED_AT
    message.updated_at = CREATED_AT + timedelta(seconds=2)
    sqlite_session.add_all([app, end_user, conversation, message])
    sqlite_session.commit()


def _workflow_run(run_id: str, app_id: str) -> WorkflowRun:
    run = WorkflowRun(
        id=run_id,
        app_id=app_id,
        tenant_id=TENANT_ID,
        workflow_id="workflow-1",
        type=WorkflowType.WORKFLOW,
        version="1",
        graph="{}",
        inputs="{}",
        outputs="{}",
        status=WorkflowExecutionStatus.RUNNING,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        finished_at=None,
        elapsed_time=0,
        total_tokens=0,
        total_steps=0,
    )
    run.created_at = CREATED_AT + timedelta(seconds=1)
    return run


@pytest.fixture
def outer_runs(sqlite_session: Session) -> None:
    """A workflow run with an owned Tool that can admit persisted child frames."""
    workflow_app = App(
        id=WORKFLOW_APP_ID,
        tenant_id=TENANT_ID,
        name="Workflow app",
        description="",
        mode=AppMode.WORKFLOW,
        enable_site=False,
        enable_api=False,
    )
    tool_node = WorkflowNodeExecutionModel(
        id=TOOL_NODE_ID,
        node_execution_id=TOOL_NODE_ID,
        tenant_id=TENANT_ID,
        app_id=WORKFLOW_APP_ID,
        workflow_id="workflow-1",
        workflow_run_id=OUTER_RUN_ID,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        index=1,
        node_id="tool",
        node_type="tool",
        title="Nested workflow",
        inputs="{}",
        outputs="{}",
        process_data="{}",
        status=WorkflowNodeExecutionStatus.RUNNING,
        elapsed_time=0,
        execution_metadata="{}",
        finished_at=None,
        created_by="account-1",
        created_by_role=CreatorUserRole.ACCOUNT,
    )
    tool_node.created_at = CREATED_AT + timedelta(seconds=2)
    sqlite_session.add_all([workflow_app, _workflow_run(OUTER_RUN_ID, WORKFLOW_APP_ID), tool_node])
    sqlite_session.commit()


def _assembler(sessions: sessionmaker[Session]) -> TraceRecordRepository:
    return TraceRecordRepository(
        sessions,
        workflow_runs=DifyAPIRepositoryFactory.create_api_workflow_run_repository(sessions),
        node_executions=DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(sessions),
        files_url="https://files.example.com",
        enterprise_details=False,
    )


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


@pytest.mark.usefixtures("records")
def test_records_copy_the_message_before_the_session_closes(sqlite_session_factory: sessionmaker[Session]) -> None:
    record = _assembler(sqlite_session_factory).assemble(
        _event(MessageCompleted(message_id=MESSAGE_ID, conversation_id="conversation-1"))
    )

    assert isinstance(record, MessageTraceInfo)
    assert record.message_data == TraceMessage(
        id=MESSAGE_ID,
        app_id=APP_ID,
        conversation_id="conversation-1",
        workflow_run_id=None,
        query="What is Dify?",
        answer="An LLM app platform.",
        error=None,
        created_at=CREATED_AT,
        model_provider=None,
        model_id=None,
        total_price=Decimal(0),
        currency="USD",
    )


def test_an_unreachable_database_is_reported_as_unavailable() -> None:
    sessions = sessionmaker(bind=create_engine("sqlite:///file:missing?mode=ro&uri=true"))

    with pytest.raises(TracingStoreUnavailableError):
        _assembler(sessions).assemble(_event(MessageCompleted(message_id=MESSAGE_ID, conversation_id="conversation-1")))


@pytest.mark.usefixtures("records", "outer_runs")
@pytest.mark.parametrize("logstore", [False, True])
def test_workflow_trace_loads_only_descendants_of_its_owned_tools(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    logstore: bool,
) -> None:
    if logstore:
        # Run the LogStore adapter's real queries against the same owner-scoped records.
        sqlite_session.execute(
            text(
                "CREATE VIEW workflow_node_execution AS SELECT *, 1 AS log_version, 1 AS __time__ "
                "FROM workflow_node_executions"
            )
        )
        monkeypatch.setattr(AliyunLogStore, "_instance", None)
        monkeypatch.setattr(AliyunLogStore, "_initialized", False)
        monkeypatch.setenv("ALIYUN_SLS_ENDPOINT", "localhost")
        monkeypatch.setattr(AliyunLogStore, "_check_endpoint_connectivity", lambda *_args: None)
        store = AliyunLogStore()

        def execute_sql(*, sql: str, **_kwargs: object) -> list[dict[str, object]]:
            with sqlite_session_factory() as session:
                return [dict(row) for row in session.execute(text(sql)).mappings()]

        monkeypatch.setattr(store, "execute_sql", execute_sql)
        apply_config_overrides(
            monkeypatch,
            API_WORKFLOW_NODE_EXECUTION_REPOSITORY=(
                "extensions.logstore.repositories.logstore_api_workflow_node_execution_repository."
                "LogstoreAPIWorkflowNodeExecutionRepository"
            ),
        )
    run = sqlite_session.get(WorkflowRun, OUTER_RUN_ID)
    tool = sqlite_session.get(WorkflowNodeExecutionModel, TOOL_NODE_ID)
    assert run is not None
    assert tool is not None
    run.status = WorkflowExecutionStatus.SUCCEEDED
    run.finished_at = CREATED_AT + timedelta(seconds=10)
    run.total_tokens = 12
    tool.node_execution_id = "caller-engine-id"
    tool.status = WorkflowNodeExecutionStatus.SUCCEEDED
    tool.finished_at = run.finished_at
    rows: list[tuple[str, str, str, str, dict[str, str]]] = [
        ("child-tool", "tool", "caller-engine-id", "workflow-1", {}),
        ("grandchild", "llm", "child-tool-engine", "child-workflow", {}),
        ("foreign-tenant", "llm", "caller-engine-id", "workflow-1", {"tenant_id": "other-tenant"}),
        ("foreign-run", "llm", "caller-engine-id", "workflow-1", {"workflow_run_id": "other-run"}),
        ("foreign-caller", "llm", "caller-engine-id", "other-workflow", {}),
        ("orphan", "llm", "unrelated-tool", "workflow-1", {}),
        ("wrong-origin", "llm", "caller-engine-id", "workflow-1", {"triggered_from": "workflow-run"}),
        ("paused", "llm", "caller-engine-id", "workflow-1", {"status": "paused"}),
    ]
    for index, (row_id, node_type, caller, caller_workflow, overrides) in enumerate(rows):
        row = WorkflowNodeExecutionModel(
            id=row_id,
            node_execution_id=f"{row_id}-engine",
            tenant_id=overrides.get("tenant_id", TENANT_ID),
            app_id="child-app",
            workflow_id="child-workflow",
            workflow_run_id=overrides.get("workflow_run_id", run.id),
            triggered_from=WorkflowNodeExecutionTriggeredFrom(overrides.get("triggered_from", "workflow-tool")),
            triggered_from_node_execution_id=caller,
            triggered_from_workflow_id=caller_workflow,
            index=index,
            node_id="same-node",
            node_type=node_type,
            title=row_id,
            status=WorkflowNodeExecutionStatus(overrides.get("status", "succeeded")),
            inputs='{"query":"hello"}',
            outputs=json.dumps({"usage": {"prompt_tokens": 5, "completion_tokens": 7}}) if node_type == "llm" else "{}",
            process_data='{"workflow_tool_invocation_id":"invocation-1"}',
            execution_metadata='{"future_metadata_key":"ignored","total_tokens":12}',
            finished_at=run.finished_at,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="account-1",
        )
        row.created_at = CREATED_AT + timedelta(seconds=3)
        sqlite_session.add(row)
    sqlite_session.commit()
    event = _event(WorkflowRunCompleted(workflow_run_id=run.id, conversation_id=None, total_tokens=None)).model_copy(
        update={"app_id": WORKFLOW_APP_ID}
    )

    record = _assembler(sqlite_session_factory).assemble(event)

    assert isinstance(record, WorkflowTraceInfo)
    assert {node.id for node in record.node_executions} == {TOOL_NODE_ID, "child-tool", "grandchild"}
    assert record.workflow_tool_parents == {"child-tool": TOOL_NODE_ID, "grandchild": "child-tool"}
    assert (record.prompt_tokens, record.completion_tokens, record.total_tokens) == (5, 7, 12)
    grandchild = next(node for node in record.node_executions if node.id == "grandchild")
    assert grandchild.inputs == {"query": "hello"}
    assert grandchild.process_data == {"workflow_tool_invocation_id": "invocation-1"}
    for owner in ({"app_id": APP_ID}, {"tenant_id": "other-tenant"}):
        with pytest.raises(SourceNotReadyError):
            _assembler(sqlite_session_factory).assemble(event.model_copy(update=owner))
