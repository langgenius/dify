import json
from copy import deepcopy
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Literal, cast
from uuid import UUID, uuid4

import pytest
from dify_agent.layers.execution_context import ApplicationTracingContext
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

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.agent_app.runtime_request_builder import AgentAppRuntimeBuildContext
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom, WorkflowAppGenerateEntity
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.nodes.agent_v2.runtime_request_builder import WorkflowAgentRuntimeBuildContext
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from graphon.runtime import VariablePool
from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
from models.application_trace import ApplicationTraceRun
from models.enums import CreatorUserRole
from models.enums import WorkflowRunTriggeredFrom as _application_trace_handoff_WorkflowRunTriggeredFrom
from models.model import App, AppMode, Message, TraceAppConfig
from models.workflow import (
    WorkflowAppLog,
    WorkflowAppLogCreatedFrom,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
)
from models.workflow import WorkflowRunTriggeredFrom as _workflow_tool_tracing_boundary_WorkflowRunTriggeredFrom
from models.workflow import WorkflowType as _application_trace_handoff_WorkflowType
from repositories.application_trace_repository import ApplicationTraceRepository, TraceCollectionError
from services.tracing import runtime_bridge
from services.tracing.assembly import TraceAssembler
from services.tracing.canonical import CanonicalTraceBuilder
from services.tracing.delivery import TraceCollectorUnavailableError, TraceDeliveryService
from services.tracing.normalization import remap_outer_trace
from services.tracing.records import WorkflowTraceInfo
from services.tracing.service import ApplicationTracingService
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_account, make_app, make_workflow
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_batch_for as batch_for
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_identifier as identifier
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_ingest as ingest
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_no_egress as no_egress
from tests.unit_tests.services.tracing.test_service import (
    _application_trace_collection_seed as _application_trace_handoff_seed,
)
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_terminal as terminal
from tests.unit_tests.services.tracing.test_service import (
    _application_trace_collection_tracing_service as tracing_service,
)
from tests.unit_tests.services.tracing.test_service import _ApplicationTraceCollectionCollection as Collection
from tests.unit_tests.services.tracing.test_service import (
    add_app_owner,
    attach_conversation,
    install_decryption,
    trace_event,
)

"""SQLite ownership regressions at the handoff from trace delivery to Agent trace collection."""


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
    collection = _application_trace_handoff_seed(sessions, name)
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
            type=_application_trace_handoff_WorkflowType.WORKFLOW,
            version="1",
            graph=json.dumps(graph),
            inputs="{}",
            outputs="{}",
            status=WorkflowExecutionStatus.SUCCEEDED,
            triggered_from=_application_trace_handoff_WorkflowRunTriggeredFrom.APP_RUN,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=identifier("owner"),
            finished_at=now + timedelta(seconds=2),
            elapsed_time=2,
            total_tokens=0,
            total_steps=0,
        )
        row.created_at = now
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


class TestApplicationTraceHandoffCases:
    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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
                node_record = WorkflowNodeExecutionModel(
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
                    finished_at=row.finished_at,
                    created_by=owner,
                    created_by_role=CreatorUserRole.ACCOUNT,
                )
                node_record.created_at = row.created_at
                session.add(node_record)
        invocation = case.collection.repository.invocation(
            run_id=managed.id,
            agent_id=identifier("agent"),
            node_execution_id=agent_node_id,
            attempt=0,
            call_key="agent:0",
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


"""Verify execution hook ownership, policy gating, and fail-open business behavior."""


@dataclass
class BridgeCase:
    target: ApplicationTracingService
    calls: list[tuple[str, dict[str, object]]] = field(default_factory=list)
    failure: Exception | None = None
    context: ApplicationTracingContext = field(
        default_factory=lambda: ApplicationTracingContext(
            run_id=uuid4(),
            invocation_id=uuid4(),
            trace_id="1" * 32,
            parent_span_id="2" * 16,
            session_id="session",
            capture_content=False,
        )
    )


def run_context(app_id: str) -> DifyRunContext:
    return DifyRunContext(
        tenant_id="tenant",
        app_id=app_id,
        user_id="account",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )


def agent_context() -> AgentAppRuntimeBuildContext:
    return AgentAppRuntimeBuildContext(
        dify_context=run_context("agent-app"),
        agent_id="agent",
        agent_config_snapshot_id="snapshot",
        agent_soul=AgentSoulConfig(),
        conversation_id="conversation",
        user_query="query",
        idempotency_key="message-id",
        binding_id="binding",
        backend_binding_ref="reference",
    )


def _runtime_bridge_workflow_context(preview: bool) -> WorkflowAgentRuntimeBuildContext:
    return WorkflowAgentRuntimeBuildContext(
        dify_context=run_context("workflow-app"),
        agent=Agent(
            id="referenced-agent",
            tenant_id="tenant",
            name="Agent",
            scope=AgentScope.ROSTER,
            source=AgentSource.ROSTER,
        ),
        snapshot=AgentConfigSnapshot(
            id="snapshot", tenant_id="tenant", agent_id="referenced-agent", version=1, config_snapshot=AgentSoulConfig()
        ),
        binding=WorkflowAgentNodeBinding(
            id="binding",
            tenant_id="tenant",
            app_id="workflow-app",
            workflow_id="workflow",
            workflow_version="draft",
            node_id="node",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            agent_id="referenced-agent",
            node_job_config=WorkflowNodeJobConfig(),
        ),
        workflow_id="workflow",
        workflow_run_id=None if preview else "run",
        node_id="node",
        node_execution_id="node-execution",
        attempt=2,
        variable_pool=VariablePool(),
        binding_id="binding",
        backend_binding_ref="reference",
    )


def _runtime_bridge_workflow_entity(extras: dict[str, object] | None = None) -> WorkflowAppGenerateEntity:
    return WorkflowAppGenerateEntity.model_construct(
        app_config=WorkflowUIBasedAppConfig(
            app_id="app", tenant_id="tenant", app_mode=AppMode.WORKFLOW, workflow_id="workflow"
        ),
        extras=extras or {},
    )


class TestRuntimeBridgeCases:
    @staticmethod
    @pytest.fixture
    def service(monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]) -> BridgeCase:
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
        target = ApplicationTracingService(
            ApplicationTraceRepository(sqlite_session_factory),
            assembler=TraceAssembler(sqlite_session_factory, files_url="https://files.test", enterprise_details=False),
            builder=CanonicalTraceBuilder(),
            egress=no_egress(),
        )
        case = BridgeCase(target)

        def prepare(**values: object) -> ApplicationTracingContext:
            if case.failure is not None:
                raise case.failure
            case.calls.append(("prepare", values))
            return case.context

        def start(**values: object) -> None:
            if case.failure is not None:
                raise case.failure
            case.calls.append(("start", values))

        def agent_terminal(**values: object) -> None:
            if case.failure is not None:
                raise case.failure
            case.calls.append(("terminal", values))

        monkeypatch.setattr(target, "prepare_invocation", prepare)
        monkeypatch.setattr(target, "start", start)
        monkeypatch.setattr(target, "capture_agent_app_terminal", agent_terminal)
        monkeypatch.setattr(runtime_bridge, "_service", lambda: target)
        return case

    @staticmethod
    def test_disabled_gate_never_constructs_database_service_or_reads_context(monkeypatch: pytest.MonkeyPatch) -> None:
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=False)
        calls = []

        def forbidden() -> ApplicationTracingService:
            calls.append(True)
            raise AssertionError("disabled tracing must not construct a service")

        monkeypatch.setattr(runtime_bridge, "_service", forbidden)
        assert runtime_bridge.prepare_agent_app(cast(AgentAppRuntimeBuildContext, object())) is None
        assert runtime_bridge.prepare_workflow_agent(cast(WorkflowAgentRuntimeBuildContext, object()), None) is None
        runtime_bridge.freeze_workflow_run(
            cast(WorkflowAppGenerateEntity, object()),
            workflow_id="workflow",
            workflow_run_id="run",
            conversation_id=None,
            graph_data={},
        )
        runtime_bridge.capture_agent_app_terminal(
            tenant_id="tenant", app_id="app", message_id="message", outcome="succeeded", output="answer"
        )
        assert calls == []

    @staticmethod
    def test_agent_app_uses_message_identity_and_stable_conversation(service: BridgeCase) -> None:
        assert runtime_bridge.prepare_agent_app(agent_context()) is service.context
        assert service.calls == [
            (
                "prepare",
                {
                    "tenant_id": "tenant",
                    "app_id": "agent-app",
                    "agent_id": "agent",
                    "source_kind": "message",
                    "source_id": "message-id",
                    "session_id": "conversation",
                    "node_execution_id": None,
                    "attempt": 0,
                    "call_key": "message-id",
                },
            )
        ]

    @staticmethod
    @pytest.mark.parametrize("preview", [False, True])
    def test_workflow_invocation_uses_owner_app_and_execution_attempt(service: BridgeCase, preview: bool) -> None:
        assert runtime_bridge.prepare_workflow_agent(_runtime_bridge_workflow_context(preview), None) is service.context
        values = service.calls[0][1]
        assert values["app_id"] == "workflow-app"
        assert values["agent_id"] == "referenced-agent"
        assert values["source_kind"] == ("node" if preview else "workflow")
        assert values["source_id"] == ("node-execution" if preview else "run")
        assert values["session_id"] == values["source_id"]
        assert values["call_key"] == "node-execution:2"
        assert values["workflow_id"] == "workflow"

    @staticmethod
    def test_workflow_start_prefers_explicit_trace_session(service: BridgeCase) -> None:
        entity = _runtime_bridge_workflow_entity({"trace_session_id": "external-session"})
        runtime_bridge.freeze_workflow_run(
            entity,
            workflow_id="workflow",
            workflow_run_id="run",
            conversation_id="conversation",
            graph_data={"nodes": [{"data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"}}]},
        )
        assert service.calls == [
            (
                "start",
                {
                    "tenant_id": "tenant",
                    "app_id": "app",
                    "source_kind": "workflow",
                    "source_id": "run",
                    "session_id": "external-session",
                    "workflow_id": "workflow",
                },
            )
        ]

    @staticmethod
    def test_business_hook_failure_logs_type_without_sensitive_exception_message(
        service: BridgeCase, caplog: pytest.LogCaptureFixture
    ) -> None:
        service.failure = ValueError("password=private-secret")
        assert runtime_bridge.prepare_agent_app(agent_context()) is None
        assert "ValueError" in caplog.text
        assert "private-secret" not in caplog.text

    @staticmethod
    def test_ordinary_workflow_does_not_create_managed_snapshot(service: BridgeCase) -> None:
        runtime_bridge.freeze_workflow_run(
            cast(WorkflowAppGenerateEntity, object()),
            workflow_id="workflow",
            workflow_run_id="run",
            conversation_id=None,
            graph_data={"nodes": [{"data": {"type": "llm"}}, {"data": {"type": "agent", "version": "1"}}]},
        )
        assert service.calls == []

    @staticmethod
    @pytest.mark.parametrize(
        "graph", ["not-json", "null", "[]", {}, {"nodes": {}}, {"nodes": [None, {"data": {"type": "llm"}}]}]
    )
    def test_invalid_or_ordinary_graph_cannot_enable_agent_collection(graph: object) -> None:
        assert runtime_bridge.workflow_has_agent_v2(graph) is False

    @staticmethod
    def test_graph_string_with_agent_is_recognized() -> None:
        assert (
            runtime_bridge.workflow_has_agent_v2(
                '{"nodes":[{"data":{"type":"agent","version":"2","agent_node_kind":"dify_agent"}}]}'
            )
            is True
        )

    @staticmethod
    @pytest.mark.parametrize("outcome", ["succeeded", "failed", "cancelled"])
    def test_worker_terminal_handoff_preserves_outcome_without_sse(service: BridgeCase, outcome: str) -> None:
        runtime_bridge.capture_agent_app_terminal(
            tenant_id="tenant",
            app_id="agent-app",
            message_id="message",
            output="answer",
            outcome=cast(Literal["succeeded", "failed", "cancelled"], outcome),
        )
        assert service.calls == [
            (
                "terminal",
                {
                    "tenant_id": "tenant",
                    "app_id": "agent-app",
                    "message_id": "message",
                    "outcome": outcome,
                    "output": "answer",
                },
            )
        ]

    @staticmethod
    def test_terminal_handoff_gate_and_fail_open_log_redact_sensitive_details(
        service: BridgeCase, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=False)
        runtime_bridge.capture_agent_app_terminal(
            tenant_id="tenant", app_id="app", message_id="message", outcome="failed", output=None
        )
        assert service.calls == []
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
        service.failure = TraceCollectionError("safe_error_code")
        runtime_bridge.capture_agent_app_terminal(
            tenant_id="tenant", app_id="app", message_id="message", outcome="failed", output="private-content"
        )
        assert "safe_error_code" in caplog.text
        assert "private-content" not in caplog.text

    @staticmethod
    def test_workflow_fail_open_logs_error_kind_without_content(
        service: BridgeCase, caplog: pytest.LogCaptureFixture
    ) -> None:
        service.failure = ValueError("private-prompt")
        assert runtime_bridge.prepare_workflow_agent(_runtime_bridge_workflow_context(False), "conversation") is None
        runtime_bridge.freeze_workflow_run(
            _runtime_bridge_workflow_entity(),
            workflow_id="workflow",
            workflow_run_id="run",
            conversation_id="conversation",
            graph_data={"nodes": [{"data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"}}]},
        )
        assert "workflow_agent" in caplog.text
        assert "workflow_start" in caplog.text
        assert "ValueError" in caplog.text
        assert "private-prompt" not in caplog.text

    @staticmethod
    def test_hooks_expose_only_the_agent_collection_lifecycle() -> None:
        hooks = runtime_bridge.RuntimeApplicationTracingHooks()
        assert hooks.prepare_agent_app is runtime_bridge.prepare_agent_app
        assert hooks.prepare_workflow_agent is runtime_bridge.prepare_workflow_agent
        assert hooks.freeze_workflow_run is runtime_bridge.freeze_workflow_run
        assert hooks.capture_agent_app_terminal is runtime_bridge.capture_agent_app_terminal
        assert {name for name in dir(hooks) if not name.startswith("_")} == {
            "prepare_agent_app",
            "prepare_workflow_agent",
            "freeze_workflow_run",
            "capture_agent_app_terminal",
        }


"""Hidden Workflow Tool Agents must not invent a trace owned by the source app."""


_workflow_tool_tracing_boundary_workflow_context = _runtime_bridge_workflow_context
_workflow_tool_tracing_boundary_workflow_entity = _runtime_bridge_workflow_entity


def _workflow_tool_tracing_boundary_seed(
    sessions: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    *,
    root_has_agent: bool,
    source_enabled: bool = True,
) -> tuple[ApplicationTracingService, WorkflowAgentRuntimeBuildContext, dict[str, str]]:
    ids = {
        name: identifier("tool-boundary-" + name)
        for name in [
            "tenant",
            "root",
            "source",
            "root_workflow",
            "source_workflow",
            "run",
            "root_agent",
            "root_tool",
            "child",
            "actor",
        ]
    }
    root_graph: dict[str, list[dict[str, object]]] = {
        "nodes": [{"id": "tool", "data": {"type": "tool", "title": "Root tool"}}],
        "edges": [],
    }
    if root_has_agent:
        root_graph["nodes"].append(
            {
                "id": "root-agent",
                "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent", "title": "Root Agent"},
            }
        )
    now = datetime(2026, 10, 21, tzinfo=UTC)
    with sessions.begin() as session:
        for app, provider, enabled, content in [
            ("root", "langfuse", True, False),
            ("source", "langsmith", source_enabled, True),
        ]:
            session.add(
                make_app(
                    app_id=ids[app],
                    tenant_id=ids["tenant"],
                    mode=AppMode.WORKFLOW,
                    tracing=json.dumps({"enabled": enabled, "tracing_provider": provider, "capture_content": content}),
                )
            )
            session.add(
                make_workflow(
                    workflow_id=ids[app + "_workflow"],
                    app_id=ids[app],
                    tenant_id=ids["tenant"],
                    graph=root_graph if app == "root" else {"nodes": [], "edges": []},
                )
            )
            session.add(
                TraceAppConfig(
                    app_id=ids[app],
                    tracing_provider=provider,
                    tracing_config={"project_url": "https://tracing.test/" + app},
                )
            )
        workflow_record = WorkflowRun(
            id=ids["run"],
            tenant_id=ids["tenant"],
            app_id=ids["root"],
            workflow_id=ids["root_workflow"],
            type=_application_trace_handoff_WorkflowType.WORKFLOW,
            triggered_from=_workflow_tool_tracing_boundary_WorkflowRunTriggeredFrom.APP_RUN,
            version="1",
            graph=json.dumps(root_graph),
            inputs="{}",
            status=WorkflowExecutionStatus.SUCCEEDED,
            created_by=ids["actor"],
            created_by_role=CreatorUserRole.ACCOUNT,
            finished_at=now + timedelta(seconds=3),
        )
        workflow_record.created_at = now
        session.add(workflow_record)
        for key, node_type in [("root_agent", "agent"), ("root_tool", "tool"), ("child", "agent")]:
            child = key == "child"
            app = "source" if child else "root"
            node_record = WorkflowNodeExecutionModel(
                id=ids[key],
                tenant_id=ids["tenant"],
                app_id=ids[app],
                workflow_id=ids[app + "_workflow"],
                workflow_run_id=ids["run"],
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL
                if child
                else WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                triggered_from_workflow_id=ids["root_workflow"] if child else None,
                triggered_from_node_execution_id=ids["root_tool"] if child else None,
                node_execution_id=ids[key],
                index=1,
                node_id=key,
                node_type=node_type,
                title=key,
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                created_by=ids["actor"],
                created_by_role=CreatorUserRole.ACCOUNT,
                finished_at=now + timedelta(seconds=2),
                inputs="{}",
                outputs="{}",
                process_data=json.dumps(
                    {"workflow_tool_root_app_id": ids["root"], "workflow_tool_invocation_id": "tool-call"}
                )
                if child
                else "{}",
            )
            node_record.created_at = now
            session.add(node_record)
    service = ApplicationTracingService(
        ApplicationTraceRepository(sessions),
        assembler=TraceAssembler(sessions, files_url="https://files.test", enterprise_details=False),
        builder=CanonicalTraceBuilder(),
        egress=no_egress(),
    )
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
    monkeypatch.setattr(runtime_bridge, "_service", lambda: service)
    entity = _workflow_tool_tracing_boundary_workflow_entity()
    entity.app_config = entity.app_config.model_copy(
        update={"app_id": ids["root"], "tenant_id": ids["tenant"], "workflow_id": ids["root_workflow"]}
    )
    runtime_bridge.freeze_workflow_run(
        entity,
        workflow_id=ids["root_workflow"],
        workflow_run_id=ids["run"],
        conversation_id=None,
        graph_data=root_graph,
    )
    original = _workflow_tool_tracing_boundary_workflow_context(False)
    context = replace(
        original,
        dify_context=original.dify_context.model_copy(
            update={"tenant_id": ids["tenant"], "app_id": ids["source"], "workflow_tool_invocation_id": "tool-call"}
        ),
        workflow_id=ids["source_workflow"],
        workflow_run_id=ids["run"],
        node_execution_id=ids["child"],
    )
    return service, context, ids


class TestWorkflowToolTracingBoundaryCases:
    @staticmethod
    @pytest.mark.parametrize("root_has_agent", [False, True])
    @pytest.mark.parametrize("source_enabled", [False, True])
    def test_hidden_child_never_reserves_source_policy_or_changes_root_freeze(
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
        root_has_agent: bool,
        source_enabled: bool,
    ) -> None:
        service, context, ids = _workflow_tool_tracing_boundary_seed(
            sqlite_session_factory, monkeypatch, root_has_agent=root_has_agent, source_enabled=source_enabled
        )
        with sqlite_session_factory() as session:
            before = deepcopy([dict(row) for row in session.execute(select(ApplicationTraceRun.__table__)).mappings()])
        service_lookups: list[bool] = []

        def lookup() -> ApplicationTracingService:
            service_lookups.append(True)
            return service

        monkeypatch.setattr(runtime_bridge, "_service", lookup)
        # Marked children never consult policy or ownership, even for malformed
        # empty markers or a foreign tenant. They cannot create an orphan B run.
        for tenant in (ids["tenant"], identifier("foreign-tool-tenant")):
            for marker in ("tool-call", ""):
                child = replace(
                    context,
                    dify_context=context.dify_context.model_copy(
                        update={
                            "tenant_id": tenant,
                            "workflow_tool_invocation_id": marker,
                        }
                    ),
                )
                assert runtime_bridge.prepare_workflow_agent(child, None) is None
        assert service_lookups == []
        with sqlite_session_factory() as session:
            observed = [
                (r.app_id, r.provider, r.capture_content, r.source_id)
                for r in session.scalars(select(ApplicationTraceRun))
            ]
            assert observed == ([(ids["root"], "langfuse", False, ids["run"])] if root_has_agent else [])
            after = [dict(row) for row in session.execute(select(ApplicationTraceRun.__table__)).mappings()]
        assert after == before
        assert (
            service.repository.source_run(
                tenant_id=ids["tenant"], app_id=ids["source"], source_kind="workflow", source_id=ids["run"]
            )
            is None
        )

    @staticmethod
    def test_hidden_child_skip_keeps_normal_root_agent_trace_assemblable(
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        service, child, ids = _workflow_tool_tracing_boundary_seed(
            sqlite_session_factory, monkeypatch, root_has_agent=True
        )
        assert runtime_bridge.prepare_workflow_agent(child, None) is None
        root_context = replace(
            child,
            dify_context=child.dify_context.model_copy(
                update={"app_id": ids["root"], "workflow_tool_invocation_id": None}
            ),
            workflow_id=ids["root_workflow"],
            node_execution_id=ids["root_agent"],
        )
        runtime = runtime_bridge.prepare_workflow_agent(root_context, None)
        assert runtime is not None
        run = service.repository.get(str(runtime.run_id))
        assert run is not None
        assert run.app_id == ids["root"]
        frozen = deepcopy(run.provider_config)
        with sqlite_session_factory.begin() as session:
            owner = session.get(App, ids["root"])
            assert owner is not None
            owner.tracing = json.dumps({"enabled": True, "tracing_provider": "langsmith", "capture_content": True})
            workflow = session.get(WorkflowRun, ids["run"])
            assert workflow is not None
        actor = make_account(account_id=ids["actor"])
        nodes = SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id=ids["tenant"],
            user=actor,
            app_id=ids["root"],
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )
        info = WorkflowTraceInfo(
            workflow_data=workflow,
            node_executions=nodes.get_by_workflow_execution(ids["run"]),
            conversation_id=None,
            message_started_at=None,
            workflow_app_log_id=None,
            workflow_id=ids["root_workflow"],
            tenant_id=ids["tenant"],
            workflow_run_id=ids["run"],
            workflow_run_elapsed_time=3,
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
            metadata={"app_id": ids["root"]},
            start_time=workflow.created_at,
            end_time=workflow.finished_at,
        )
        outer = CanonicalTraceBuilder().build(info)
        assert outer is not None
        outer = remap_outer_trace(outer, trace_id=run.trace_id, capture_content=False, synthetic_span_ids=frozenset())
        service.repository.terminal(run.id, outer.model_dump(mode="json"), outer.root.span_id)
        invocation = service.repository.collected(run.id)[0][0]
        ingest(Collection(service.repository, sqlite_session_factory, run), batch_for(run, invocation))
        current = service.repository.get(run.id)
        assert current is not None
        trace = service.assemble(current)
        span_ids = {span.span_id for span in trace.spans}
        assert all(span.parent_span_id is None or span.parent_span_id in span_ids for span in trace.spans)
        assert current.provider_config == frozen
        assert current.provider == "langfuse"
        assert current.capture_content is False
