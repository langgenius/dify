"""SQLite ownership regressions at the handoff from trace delivery to Agent trace collection."""

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from dify_agent.protocol.tracing import AgentTraceBatch, AgentTraceSpan
from dify_trace_sdk.events import (
    ConversationNamed,
    MessageCompleted,
    ModerationChecked,
    TraceCorrelation,
    TraceEvent,
    TracePayload,
    WorkflowRunCompleted,
)
from dify_trace_sdk.testing import RecordingEgress, response
from sqlalchemy import delete, func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.agent_app.runtime_request_builder import AgentAppRuntimeBuildContext
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from models.agent_config_entities import AgentSoulConfig
from models.application_trace import ApplicationTraceRun
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import App, AppMode, Message
from models.workflow import (
    WorkflowAppLog,
    WorkflowAppLogCreatedFrom,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowType,
)
from services.tracing import runtime_bridge
from services.tracing.canonical import CanonicalTraceBuilder
from services.tracing.delivery import TraceCollectorUnavailableError, TraceDeliveryService
from services.tracing.records import WorkflowTraceInfo
from services.tracing.service import ApplicationTracingService
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_workflow
from tests.unit_tests.services.tracing.test_application_trace_collection import (
    Collection,
    add_app_owner,
    attach_conversation,
    identifier,
    install_decryption,
    no_egress,
    seed,
    terminal,
    trace_event,
    tracing_service,
)

AGENT_GRAPH = {
    "nodes": [{"id": "agent", "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"}}],
    "edges": list[object](),
}
STARTED_AT = datetime(2026, 10, 15, tzinfo=UTC)


@dataclass
class Case:
    collection: Collection
    service: ApplicationTracingService
    scheduled: list[str]


def setup(
    sessions: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, name: str, mode: AppMode, *, snapshot: bool
) -> Case:
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
    install_decryption(monkeypatch)
    collection = seed(sessions, name)
    attach_conversation(collection, mode)
    with sessions.begin() as session:
        app = session.get(App, collection.run.app_id)
        assert app is not None
        app.mode = mode
        if not snapshot:
            session.execute(delete(ApplicationTraceRun).where(ApplicationTraceRun.id == collection.run.id))
    service = tracing_service(collection, no_egress())
    scheduled: list[str] = []
    monkeypatch.setattr(service, "schedule", scheduled.append)
    monkeypatch.setattr(runtime_bridge, "_service", lambda: service)
    return Case(collection, service, scheduled)


def deliver(case: Case, event: TraceEvent, destination: RecordingEgress) -> None:
    """Deliver one event the way the trace worker does, with this case's ledger as the Agent collector."""
    TraceDeliveryService(
        session_factory=case.collection.sessions,
        assembler=case.service.assembler,
        builder=CanonicalTraceBuilder(),
        egress=destination,
        enterprise_sink=None,
        collector=case.service,
        max_export_attempts=1,
    ).deliver(event, enterprise_delivered=False)


def exported() -> RecordingEgress:
    """A provider destination that accepts exactly one ingestion request."""
    return RecordingEgress([response(200, {})], grpc_target=None)


def ingested(destination: RecordingEgress) -> list[dict[str, object]]:
    """The Langfuse ingestion events the provider sent."""
    events: list[dict[str, object]] = []
    for request in destination.requests:
        body = request.json()
        assert isinstance(body, dict)
        batch = body.get("batch")
        assert isinstance(batch, list)
        events.extend(item for item in batch if isinstance(item, dict))
    return events


def message(case: Case) -> Message:
    with case.collection.sessions() as session:
        row = session.get(Message, case.collection.run.source_id)
        assert row is not None
        return row


def message_event(case: Case) -> TraceEvent:
    row = message(case)
    return trace_event(case.collection, MessageCompleted(message_id=row.id, conversation_id=row.conversation_id))


def workflow_event(row: WorkflowRun, parent: WorkflowRun | None) -> TraceEvent:
    return TraceEvent(
        event_id=uuid4().hex,
        tenant_id=row.tenant_id,
        app_id=row.app_id,
        user_id=None,
        occurred_at=datetime.now(UTC),
        correlation=TraceCorrelation(
            external_trace_id=None,
            session_id=None,
            parent_workflow_run_id=parent.id if parent else None,
            parent_node_execution_id=identifier("parent-tool-node") if parent else None,
        ),
        payload=WorkflowRunCompleted(workflow_run_id=row.id, conversation_id=None, total_tokens=None),
    )


def workflow(
    case: Case, name: str, *, has_agent: bool, snapshot: bool
) -> tuple[WorkflowRun, ApplicationTraceRun | None]:
    graph = AGENT_GRAPH if has_agent else {"nodes": [{"data": {"type": "llm"}}], "edges": list[object]()}
    now = datetime(2026, 10, 15)
    with case.collection.sessions.begin() as session:
        definition = make_workflow(
            workflow_id=identifier(f"workflow-{name}"),
            tenant_id=case.collection.run.tenant_id,
            app_id=case.collection.run.app_id,
            graph=graph,
        )
        session.add(definition)
        app = session.get(App, case.collection.run.app_id)
        assert app is not None
        app.workflow_id = definition.id
        row = WorkflowRun(
            id=identifier(f"workflow-run-{name}"),
            app_id=app.id,
            tenant_id=app.tenant_id,
            workflow_id=definition.id,
            type=WorkflowType.WORKFLOW,
            version="1",
            graph=json.dumps(graph),
            inputs="{}",
            outputs="{}",
            status=WorkflowExecutionStatus.SUCCEEDED,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=identifier("owner"),
            created_at=now,
            finished_at=now + timedelta(seconds=2),
            elapsed_time=2,
            total_tokens=0,
            total_steps=0,
        )
        session.add(row)
    trace_run = (
        case.collection.repository.start(
            tenant_id=row.tenant_id,
            app_id=row.app_id,
            source_kind="workflow",
            source_id=row.id,
            session_id="workflow-session",
        )
        if snapshot
        else None
    )
    return row, trace_run


def workflow_info(row: WorkflowRun, parent: WorkflowRun | None) -> WorkflowTraceInfo:
    metadata: dict[str, object] = {"app_id": row.app_id}
    if parent is not None:
        metadata["parent_trace_context"] = {
            "parent_workflow_run_id": parent.id,
            "parent_node_execution_id": identifier("parent-tool-node"),
        }
    return WorkflowTraceInfo(
        workflow_data=row,
        node_executions=[],
        conversation_id=None,
        message_started_at=None,
        workflow_app_log_id=None,
        workflow_id=row.workflow_id,
        tenant_id=row.tenant_id,
        workflow_run_id=row.id,
        workflow_run_elapsed_time=2,
        workflow_run_status="succeeded",
        workflow_run_inputs={},
        workflow_run_outputs={},
        workflow_run_version="1",
        error=None,
        total_tokens=0,
        prompt_tokens=None,
        completion_tokens=None,
        file_list=[],
        invoked_by=None,
        query="",
        metadata=metadata,
        start_time=row.created_at,
        end_time=row.finished_at,
    )


def run_count(case: Case) -> int | None:
    with case.collection.sessions() as session:
        return session.scalar(select(func.count()).select_from(ApplicationTraceRun))


def test_chatflow_message_event_is_not_exported_again(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    case = setup(sqlite_session_factory, monkeypatch, "chatflow", AppMode.ADVANCED_CHAT, snapshot=False)
    row, trace_run = workflow(case, "chatflow", has_agent=True, snapshot=True)
    assert trace_run is not None
    terminal(Collection(case.collection.repository, case.collection.sessions, trace_run))
    before = case.collection.repository.get(trace_run.id)
    assert before is not None
    with case.collection.sessions.begin() as session:
        stored = session.get(Message, case.collection.run.source_id)
        assert stored is not None
        stored.workflow_run_id = row.id
    destination = no_egress()
    deliver(case, message_event(case), destination)
    assert destination.requests == []
    after = case.collection.repository.get(trace_run.id)
    assert after is not None
    assert after.outer_trace == before.outer_trace
    assert case.scheduled == []
    assert run_count(case) == 1


@pytest.mark.parametrize("mode", [AppMode.AGENT, AppMode.ADVANCED_CHAT])
def test_snapshot_failure_is_persisted_and_never_falls_back(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, mode: AppMode
) -> None:
    case = setup(sqlite_session_factory, monkeypatch, "failure", mode, snapshot=False)

    def fail_start(**_kwargs: object) -> None:
        raise OperationalError("snapshot", {}, Exception("temporary database unavailable"))

    monkeypatch.setattr(case.collection.repository, "start", fail_start)
    context = AgentAppRuntimeBuildContext(
        dify_context=DifyRunContext(
            tenant_id=case.collection.run.tenant_id,
            app_id=case.collection.run.app_id,
            user_id=identifier("user"),
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
        ),
        agent_id=identifier("agent"),
        idempotency_key=case.collection.run.source_id,
        conversation_id="conversation",
        agent_config_snapshot_id=identifier("snapshot"),
        agent_soul=AgentSoulConfig(),
        user_query="query",
        binding_id=identifier("binding"),
        backend_binding_ref="backend",
    )
    assert runtime_bridge.prepare_agent_app(context) is None
    destination = no_egress()
    deliver(case, message_event(case), destination)
    assert destination.requests == []
    stored = case.collection.repository.source_run(
        tenant_id=case.collection.run.tenant_id,
        app_id=case.collection.run.app_id,
        source_kind="message",
        source_id=case.collection.run.source_id,
    )
    assert stored is not None
    assert stored.state == "failed"
    assert stored.error_code == "tracing_initialization_failed"
    assert stored.provider_config == {}


@pytest.mark.parametrize("mode", [AppMode.AGENT, AppMode.ADVANCED_CHAT, AppMode.CHAT])
@pytest.mark.parametrize("kind", ["title", "moderation", "aliased_moderation"])
def test_auxiliary_events_resolve_owner_without_bypassing_content_policy(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, mode: AppMode, kind: str
) -> None:
    case = setup(sqlite_session_factory, monkeypatch, "aux", mode, snapshot=False)
    row = message(case)
    if kind == "aliased_moderation":
        # Chatflow moderation is keyed by its workflow log, not by the message it guards.
        workflow_run_id = identifier("aliased-workflow-run")
        with case.collection.sessions.begin() as session:
            stored = session.get(Message, row.id)
            assert stored is not None
            stored.workflow_run_id = workflow_run_id
            session.add(
                WorkflowAppLog(
                    tenant_id=case.collection.run.tenant_id,
                    app_id=case.collection.run.app_id,
                    workflow_id=identifier("aliased-workflow"),
                    workflow_run_id=workflow_run_id,
                    created_from=WorkflowAppLogCreatedFrom.WEB_APP,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=identifier("owner"),
                )
            )
    payload: TracePayload = (
        ConversationNamed(
            conversation_id=row.conversation_id,
            message_id=row.id,
            inputs="private conversation",
            name="private generated title",
            started_at=STARTED_AT,
            ended_at=STARTED_AT,
        )
        if kind == "title"
        else ModerationChecked(
            message_id=row.id,
            inputs={"query": "private prompt"},
            query="private prompt",
            flagged=False,
            action="direct_output",
            preset_response="",
            started_at=STARTED_AT,
            ended_at=STARTED_AT,
        )
    )
    destination = exported() if mode is AppMode.CHAT else no_egress()
    deliver(case, trace_event(case.collection, payload), destination)
    assert len(destination.requests) == (1 if mode is AppMode.CHAT else 0)
    assert case.scheduled == []
    assert run_count(case) == 0


def test_plain_nested_workflow_keeps_its_parent_context_for_the_provider(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    parent_case = setup(sqlite_session_factory, monkeypatch, "plain-parent", AppMode.WORKFLOW, snapshot=False)
    parent, _ = workflow(parent_case, "plain-parent", has_agent=False, snapshot=False)
    child_case = setup(sqlite_session_factory, monkeypatch, "plain-child", AppMode.WORKFLOW, snapshot=False)
    child, _ = workflow(child_case, "plain-child", has_agent=False, snapshot=False)
    add_app_owner(child_case.collection, "plain-child")
    event = workflow_event(child, parent)
    record = child_case.service.assembler.assemble(event)
    assert isinstance(record, WorkflowTraceInfo)
    assert child_case.service.capture_terminal(record) is False
    assert child_case.service.link_managed_parent(record) is record
    destination = exported()
    deliver(child_case, event, destination)
    trace = next(item for item in ingested(destination) if item["type"] == "trace-create")
    body = trace["body"]
    assert isinstance(body, dict)
    assert body["metadata"]["parent_workflow_run_id"] == parent.id
    assert body["metadata"]["parent_node_execution_id"] == identifier("parent-tool-node")
    assert "linked_parent_workflow_run_id" not in body["metadata"]
    assert run_count(child_case) == 0


def test_plain_chatflow_auxiliary_events_keep_the_provider_route(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    case = setup(sqlite_session_factory, monkeypatch, "plain-chatflow", AppMode.ADVANCED_CHAT, snapshot=False)
    row, _ = workflow(case, "plain-chatflow", has_agent=False, snapshot=False)
    with case.collection.sessions.begin() as session:
        stored = session.get(Message, case.collection.run.source_id)
        assert stored is not None
        stored.workflow_run_id = row.id
        payload = ConversationNamed(
            conversation_id=stored.conversation_id,
            message_id=stored.id,
            inputs="provider input",
            name="provider title",
            started_at=STARTED_AT,
            ended_at=STARTED_AT,
        )
    destination = exported()
    deliver(case, trace_event(case.collection, payload), destination)
    assert len(destination.requests) == 1


def test_provider_exported_child_of_managed_parent_names_the_collected_parent(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    parent_case = setup(sqlite_session_factory, monkeypatch, "managed-parent", AppMode.WORKFLOW, snapshot=False)
    parent, parent_trace = workflow(parent_case, "managed-parent", has_agent=True, snapshot=True)
    assert parent_trace is not None
    child_case = setup(sqlite_session_factory, monkeypatch, "provider-child", AppMode.WORKFLOW, snapshot=False)
    child, _ = workflow(child_case, "provider-child", has_agent=False, snapshot=False)
    info = workflow_info(child, parent)
    assert child_case.service.capture_terminal(info) is False
    linked = child_case.service.link_managed_parent(info)
    assert linked.resolved_parent_context == (None, None)
    assert linked.metadata["linked_parent_workflow_run_id"] == parent.id
    assert linked.metadata["linked_parent_node_execution_id"] == identifier("parent-tool-node")
    assert linked.metadata["linked_parent_application_trace_id"] == parent_trace.id
    assert linked.metadata["linked_parent_trace_id"] == parent_trace.trace_id
    # Records are frozen: the delivered record is a copy, the original keeps its unavailable context.
    assert info.resolved_parent_context == (parent.id, identifier("parent-tool-node"))
    add_app_owner(child_case.collection, "provider-child")
    destination = exported()
    deliver(child_case, workflow_event(child, parent), destination)
    trace = next(item for item in ingested(destination) if item["type"] == "trace-create")
    body = trace["body"]
    assert isinstance(body, dict)
    assert body["metadata"]["linked_parent_trace_id"] == parent_trace.trace_id
    assert "parent_workflow_run_id" not in body["metadata"]


def test_collector_database_failure_redelivers_without_provider_fallback(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    case = setup(sqlite_session_factory, monkeypatch, "collector-unavailable", AppMode.AGENT, snapshot=True)

    def unavailable(**_kwargs: object) -> None:
        raise OperationalError("statement", {}, Exception("sensitive database error"))

    monkeypatch.setattr(case.collection.repository, "source_run", unavailable)
    destination = no_egress()
    with pytest.raises(TraceCollectorUnavailableError):
        deliver(case, message_event(case), destination)
    assert destination.requests == []


def test_mixed_workflow_exports_normal_llm_and_agent_calls_without_double_usage(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    case = setup(sqlite_session_factory, monkeypatch, "mixed", AppMode.WORKFLOW, snapshot=False)
    row, managed = workflow(case, "mixed", has_agent=True, snapshot=True)
    assert managed is not None
    owner = add_app_owner(case.collection, "mixed")
    agent_node_id = identifier("agent-execution")
    with case.collection.sessions.begin() as session:
        for index, kind in enumerate(("llm", "agent")):
            node_id = identifier("normal-execution") if kind == "llm" else agent_node_id
            usage: dict[str, int] = (
                {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15} if kind == "llm" else {}
            )
            session.add(
                WorkflowNodeExecutionModel(
                    id=node_id,
                    node_execution_id=node_id,
                    tenant_id=row.tenant_id,
                    app_id=row.app_id,
                    workflow_id=row.workflow_id,
                    workflow_run_id=row.id,
                    triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                    index=index,
                    node_id=kind,
                    node_type=kind,
                    title=kind,
                    inputs="{}",
                    outputs="{}",
                    process_data=json.dumps(
                        {
                            "model_mode": "chat",
                            "model_name": "ordinary-model",
                            "model_provider": "openai",
                            "usage": usage,
                        }
                    )
                    if kind == "llm"
                    else "{}",
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    elapsed_time=1,
                    execution_metadata=json.dumps(
                        {"total_tokens": 15 if kind == "llm" else 10, "total_price": "0.02", "currency": "USD"}
                    ),
                    created_at=row.created_at,
                    finished_at=row.finished_at,
                    created_by=owner,
                    created_by_role=CreatorUserRole.ACCOUNT,
                )
            )
    invocation = case.collection.repository.invocation(
        run_id=managed.id, agent_id=identifier("agent"), node_execution_id=agent_node_id, attempt=0, call_key="agent:0"
    )
    spans = [
        AgentTraceSpan(
            trace_id=managed.trace_id,
            span_id="a" * 16,
            parent_span_id=invocation.span_id,
            name="agent run",
            start_time_ns=1_000_000_000,
            end_time_ns=3_000_000_000,
            status="ok",
            attributes={"gen_ai.operation.name": "invoke_agent"},
        )
    ]
    spans.extend(
        AgentTraceSpan(
            trace_id=managed.trace_id,
            span_id=key * 16,
            parent_span_id="a" * 16,
            name="model call",
            start_time_ns=1_000_000_000,
            end_time_ns=2_000_000_000,
            status="ok",
            attributes={
                "gen_ai.operation.name": "chat",
                "gen_ai.request.model": "agent-model",
                "gen_ai.usage.input_tokens": 3,
                "gen_ai.usage.output_tokens": 2,
                "dify.llm.total_price": "0.01",
                "dify.llm.currency": "USD",
            },
        )
        for key in ("b", "c")
    )
    case.collection.repository.ingest(
        AgentTraceBatch(
            run_id=UUID(managed.id), invocation_id=UUID(invocation.id), batch_id=uuid4(), final=True, spans=spans
        ),
        max_spans=100,
        max_bytes=100000,
    )
    record = case.service.assembler.assemble(workflow_event(row, None))
    assert isinstance(record, WorkflowTraceInfo)
    assert case.service.capture_terminal(record) is True
    assert case.scheduled == [managed.id]
    destination = exported()
    tracing_service(Collection(case.collection.repository, case.collection.sessions, managed), destination).deliver(
        managed.id
    )
    delivered = case.collection.repository.get(managed.id)
    assert delivered is not None
    assert delivered.state == "accepted"
    assert [request.url for request in destination.requests] == ["https://langfuse.test/api/public/ingestion"]
    generations = [item["body"] for item in ingested(destination) if item["type"] == "generation-create"]
    usages = [body["usage"] for body in generations if isinstance(body, dict)]
    assert len(usages) == 3
    assert sum(usage["total"] for usage in usages) == 25
    assert sum(usage["totalCost"] for usage in usages) == pytest.approx(0.04)
