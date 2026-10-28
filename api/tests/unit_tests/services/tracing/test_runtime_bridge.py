import json
from copy import deepcopy
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Literal, override
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

import pytest
from dify_agent.layers.execution_context import ApplicationTracingContext
from dify_agent.protocol.tracing import AgentTraceBatch, AgentTraceSpan
from dify_trace_langfuse.provider import LangfuseProvider
from dify_trace_sdk.egress import Egress
from dify_trace_sdk.events import (
    ConversationNamed,
    MessageCompleted,
    ModerationChecked,
    TraceCorrelation,
    TraceEvent,
    TraceParent,
    TracePayload,
    WorkflowRunCompleted,
)
from dify_trace_sdk.ids import span_id_for, span_uuid, trace_id_for, trace_uuid
from dify_trace_sdk.model import Span, SpanKind, SpanStatus, Trace
from dify_trace_sdk.testing import RecordingEgress, response
from flask import Flask
from sqlalchemy import URL, Engine, create_engine, delete, event, func, select
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.agent_app.runtime_request_builder import AgentAppRuntimeBuildContext
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom, WorkflowAppGenerateEntity
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.nodes.agent_v2.runtime_request_builder import WorkflowAgentRuntimeBuildContext
from domain.tracing.trace_run_agg import TraceRunState, TraceSourceKind
from extensions.tracing import application_tracing_hooks, bind_tracing
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from graphon.runtime import VariablePool
from libs.datetime_utils import naive_utc_now
from models.account import Tenant, TenantAccountJoin, TenantAccountRole
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
from models.enums import ConversationFromSource, CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import App, AppMode, Message, TraceAppConfig
from models.workflow import (
    WorkflowAppLog,
    WorkflowAppLogCreatedFrom,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowType,
)
from repositories.app.tracing_config_repository import SQLAlchemyAppTracingConfigRepository
from repositories.application_trace_repository import ApplicationTraceRepository
from repositories.trace_record_repository import TraceRecordRepository
from services.tracing.adapters import StoredPolicyTraceScopes
from services.tracing.canonical import CanonicalTraceBuilder
from services.tracing.collection import AgentTraceSettings, AppTracingSnapshot, TraceRun, workflow_has_agent_v2
from services.tracing.delivery import ExportJob, ExportRetryQueue, TraceDeliveryService
from services.tracing.errors import TraceCollectorUnavailableError, TracingStoreUnavailableError
from services.tracing.providers import ProviderConfigCodec
from services.tracing.records import WorkflowTraceInfo
from services.tracing.runtime_bridge import RuntimeApplicationTracingHooks
from services.tracing.scopes import TraceScopes
from services.tracing.service import ApplicationTracingService
from tests.helpers.unit.model_factories import (
    make_account,
    make_app,
    make_conversation,
    make_message,
    make_tenant,
    make_workflow,
)
from tests.helpers.unit.services.tracing_ports import (
    AGENT_TRACE_SETTINGS,
    InstalledTraceProviders,
    WorkspaceBoundCipher,
)

"""SQLite ownership regressions at the handoff from trace delivery to Agent trace collection."""


AGENT_GRAPH = {
    "nodes": [{"id": "agent", "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"}}],
    "edges": list[object](),
}


STARTED_AT = datetime(2026, 10, 15, tzinfo=UTC)


def identifier(value: str) -> str:
    return str(uuid5(NAMESPACE_URL, value))


@dataclass(frozen=True)
class Collection:
    repository: ApplicationTraceRepository
    sessions: sessionmaker[Session]
    run: TraceRun


class _Recorder:
    def __init__(self) -> None:
        self.events: list[TraceEvent] = []

    def emit(self, event: TraceEvent) -> None:
        self.events.append(event)


class _SingleAttempt(ExportRetryQueue):
    """Delivery here makes one provider attempt; it never schedules a retry."""

    @override
    def schedule(self, job: ExportJob, *, delay_seconds: int) -> None:
        raise AssertionError(f"unexpected export retry: provider={job.provider_id}")


class _FreezeFails(ApplicationTraceRepository):
    """The real ledger, except that reading the tracing snapshot a run freezes fails with ``failure``."""

    def __init__(self, sessions: sessionmaker[Session], failure: Exception) -> None:
        super().__init__(sessions)
        self._failure = failure

    @override
    def app_tracing(self, *, tenant_id: str, app_id: str) -> AppTracingSnapshot | None:
        raise self._failure


def record_source(sessions: sessionmaker[Session]) -> TraceRecordRepository:
    return TraceRecordRepository(sessions, files_url="https://files.test", enterprise_details=False)


def tracing_service(
    sessions: sessionmaker[Session],
    traces: ApplicationTraceRepository,
    egress: Egress,
    scheduled: list[str],
    settings: AgentTraceSettings,
) -> ApplicationTracingService:
    """Agent trace collection exporting to Langfuse; scheduled exports are recorded instead of enqueued."""
    return ApplicationTracingService(
        runs=traces,
        run_query=traces,
        sources=traces,
        records=record_source(sessions),
        builder=CanonicalTraceBuilder(),
        providers=InstalledTraceProviders(LangfuseProvider),
        codec=ProviderConfigCodec(WorkspaceBoundCipher()),
        egress=egress,
        schedule_export=scheduled.append,
        settings=settings,
    )


def trace_scopes(sessions: sessionmaker[Session]) -> StoredPolicyTraceScopes:
    """Trace scopes as the composition root binds them, with events kept in memory."""
    return StoredPolicyTraceScopes(
        TraceScopes(
            emitter=_Recorder(),
            policies=SQLAlchemyAppTracingConfigRepository(session_factory=sessions),
            enterprise_enabled=lambda: False,
        )
    )


def langfuse_config(tenant_id: str, host: str) -> dict[str, str]:
    """A stored Langfuse configuration whose secrets only ``tenant_id`` decrypts."""
    cipher = WorkspaceBoundCipher()
    return {
        "public_key": cipher.encrypt(tenant_id, "public"),
        "secret_key": cipher.encrypt(tenant_id, "secret"),
        "host": host,
    }


def no_egress() -> RecordingEgress:
    """An egress that fails any request the test did not script."""
    return RecordingEgress([], grpc_target=None)


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


def observations(destination: RecordingEgress) -> list[dict[str, object]]:
    """The Langfuse observations the provider sent: every span except the trace's root."""
    bodies: list[dict[str, object]] = []
    for item in ingested(destination):
        body = item["body"]
        assert isinstance(body, dict)
        if item["type"] != "trace-create":
            bodies.append(body)
    return bodies


def run_count(sessions: sessionmaker[Session]) -> int | None:
    with sessions() as session:
        return session.scalar(select(func.count()).select_from(ApplicationTraceRun))


def seed(sessions: sessionmaker[Session], name: str) -> Collection:
    """An Agent app tracing to Langfuse, one of its messages, and the run frozen when the message started."""
    app_id, tenant_id, message_id = identifier(f"app-{name}"), identifier("tenant"), identifier(f"message-{name}")
    with sessions.begin() as session:
        session.add(
            make_app(
                app_id=app_id,
                tenant_id=tenant_id,
                mode=AppMode.AGENT,
                tracing=json.dumps(
                    {"enabled": True, "tracing_provider": "langfuse", "capture_content": False, "capture_agent": True}
                ),
            )
        )
        session.add(
            make_message(
                message_id=message_id,
                app_id=app_id,
                conversation_id=identifier(f"conversation-{name}"),
                inputs={},
                query="hello",
                message={},
                answer="done",
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.CONSOLE,
            )
        )
        session.add(
            TraceAppConfig(
                app_id=app_id,
                tracing_provider="langfuse",
                tracing_config=langfuse_config(tenant_id, "https://langfuse.test"),
            )
        )
    repository = ApplicationTraceRepository(sessions)
    run = tracing_service(sessions, repository, no_egress(), [], AGENT_TRACE_SETTINGS).start(
        tenant_id=tenant_id,
        app_id=app_id,
        source_kind="message",
        source_id=message_id,
        session_id="session-original",
        workflow_id=None,
    )
    assert run is not None
    return Collection(repository, sessions, run)


def attach_conversation(collection: Collection, mode: AppMode) -> None:
    """Message records are assembled only for a message whose conversation belongs to its app."""
    with collection.sessions.begin() as session:
        message = session.get(Message, collection.run.source_id)
        assert message is not None
        session.add(
            make_conversation(
                conversation_id=message.conversation_id,
                app_id=collection.run.app_id,
                mode=mode,
                inputs={},
                from_source=ConversationFromSource.CONSOLE,
            )
        )


def add_app_owner(collection: Collection, name: str) -> str:
    """An account of the app's workspace that creates the app."""
    owner_id = identifier(f"owner-{name}")
    with collection.sessions.begin() as session:
        if session.get(Tenant, collection.run.tenant_id) is None:
            session.add(make_tenant(tenant_id=collection.run.tenant_id))
        session.add(make_account(account_id=owner_id, email=f"{name}@example.com"))
        session.add(
            TenantAccountJoin(tenant_id=collection.run.tenant_id, account_id=owner_id, role=TenantAccountRole.OWNER)
        )
        app = session.get(App, collection.run.app_id)
        assert app is not None
        app.created_by = owner_id
    return owner_id


def trace_event(run: TraceRun, payload: TracePayload) -> TraceEvent:
    return TraceEvent(
        event_id=uuid4().hex,
        tenant_id=run.tenant_id,
        app_id=run.app_id,
        user_id=None,
        occurred_at=datetime.now(UTC),
        correlation=TraceCorrelation(external_trace_id=None, session_id=None, parent=None),
        payload=payload,
    )


def capture(traces: ApplicationTraceRepository, run_id: str, trace: Trace) -> None:
    """Keep a business terminal in its run without scheduling the run's export."""
    with traces.change(run_id) as locked:
        assert locked is not None
        locked.run.capture_terminal(trace, now=naive_utc_now())


def ingest(traces: ApplicationTraceRepository, batch: AgentTraceBatch, *, max_spans: int, max_bytes: int) -> None:
    """Store a runtime batch in its run without scheduling the run's export."""
    with traces.change(str(batch.run_id)) as locked:
        assert locked is not None
        locked.run.ingest(batch.model_dump(mode="json"), max_spans=max_spans, max_bytes=max_bytes, now=naive_utc_now())


def terminal(collection: Collection) -> None:
    """Persist a root-only business terminal for the collection's run."""
    run = collection.run
    root = Span(
        span_id=run.root_span_id,
        parent_span_id=None,
        name="Agent turn",
        kind=SpanKind.CHAIN,
        start_time=datetime.fromtimestamp(0, UTC),
        end_time=datetime.fromtimestamp(3, UTC),
        status=SpanStatus.OK,
    )
    trace = Trace(
        trace_id=run.trace_id,
        external_trace_id=None,
        session_id=run.session_id,
        user_id=None,
        parent=None,
        trace_root=None,
        spans=(root,),
    )
    capture(collection.repository, run.id, trace)


@dataclass(frozen=True)
class Case:
    collection: Collection
    service: ApplicationTracingService
    scheduled: list[str]


def handoff(collection: Collection, traces: ApplicationTraceRepository, egress: Egress) -> Case:
    """The Agent collector over ``traces``, exporting through ``egress``."""
    scheduled: list[str] = []
    return Case(
        collection, tracing_service(collection.sessions, traces, egress, scheduled, AGENT_TRACE_SETTINGS), scheduled
    )


def setup(sessions: sessionmaker[Session], name: str, mode: AppMode, *, snapshot: bool) -> Case:
    collection = seed(sessions, name)
    attach_conversation(collection, mode)
    with sessions.begin() as session:
        app = session.get(App, collection.run.app_id)
        assert app is not None
        app.mode = mode
        if not snapshot:
            session.execute(delete(ApplicationTraceRun).where(ApplicationTraceRun.id == collection.run.id))
    return handoff(collection, collection.repository, no_egress())


def deliver(case: Case, event: TraceEvent, destination: RecordingEgress) -> None:
    """Deliver one event the way the trace worker does, with this case's service as the Agent collector."""
    sessions = case.collection.sessions
    records = record_source(sessions)
    TraceDeliveryService(
        records=records,
        outer_runs=records,
        destinations=SQLAlchemyAppTracingConfigRepository(session_factory=sessions),
        providers=InstalledTraceProviders(LangfuseProvider),
        codec=ProviderConfigCodec(WorkspaceBoundCipher()),
        builder=CanonicalTraceBuilder(),
        egress=destination,
        retries=_SingleAttempt(),
        enterprise_sink=None,
        collector=case.service,
        max_export_attempts=1,
    ).deliver(event, enterprise_delivered=False)


def message(case: Case) -> Message:
    with case.collection.sessions() as session:
        row = session.get(Message, case.collection.run.source_id)
        assert row is not None
        return row


def message_event(case: Case) -> TraceEvent:
    row = message(case)
    return trace_event(case.collection.run, MessageCompleted(message_id=row.id, conversation_id=row.conversation_id))


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
            parent=TraceParent(
                workflow_run_id=parent.id,
                app_id=parent.app_id,
                node_execution_id=identifier("parent-tool-node"),
                external_trace_id=None,
                parent=None,
            )
            if parent
            else None,
        ),
        payload=WorkflowRunCompleted(workflow_run_id=row.id, conversation_id=None, total_tokens=None),
    )


def workflow(case: Case, name: str, *, has_agent: bool, snapshot: bool) -> tuple[WorkflowRun, TraceRun | None]:
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
            finished_at=now + timedelta(seconds=2),
            elapsed_time=2,
            total_tokens=0,
            total_steps=0,
        )
        row.created_at = now
        session.add(row)
    trace_run = (
        case.service.start(
            tenant_id=row.tenant_id,
            app_id=row.app_id,
            source_kind="workflow",
            source_id=row.id,
            session_id="workflow-session",
            workflow_id=None,
        )
        if snapshot
        else None
    )
    return row, trace_run


def tool_node(case: Case, row: WorkflowRun) -> None:
    """Persist the tool node execution of ``row`` that starts the nested runs of these cases."""
    with case.collection.sessions.begin() as session:
        node = WorkflowNodeExecutionModel(
            id=identifier("parent-tool-node"),
            node_execution_id=identifier("parent-tool-node"),
            tenant_id=row.tenant_id,
            app_id=row.app_id,
            workflow_id=row.workflow_id,
            workflow_run_id=row.id,
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
            created_by=row.created_by,
            created_by_role=CreatorUserRole.ACCOUNT,
        )
        node.created_at = row.created_at + timedelta(seconds=1)
        session.add(node)


def nested_root(destination: RecordingEgress, trace_id: str, child: WorkflowRun) -> dict[str, object]:
    """The Langfuse observation of a nested run's root, after checking it was sent as a fragment."""
    events = ingested(destination)
    assert all(item["type"] != "trace-create" for item in events)
    bodies = [item["body"] for item in events if isinstance(item["body"], dict)]
    (root,) = [body for body in bodies if body["id"] == str(span_uuid(trace_id, span_id_for(child.id)))]
    assert root["traceId"] == str(trace_uuid(trace_id))
    assert root["parentObservationId"] == str(span_uuid(trace_id, span_id_for(identifier("parent-tool-node"))))
    return root


def workflow_info(row: WorkflowRun, parent: WorkflowRun | None) -> WorkflowTraceInfo:
    assert row.finished_at is not None
    metadata: dict[str, object] = {"app_id": row.app_id}
    if parent is not None:
        metadata["parent_trace_context"] = {
            "parent_workflow_run_id": parent.id,
            "parent_node_execution_id": identifier("parent-tool-node"),
        }
    return WorkflowTraceInfo(
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
        parent=None,
        metadata=metadata,
        start_time=row.created_at,
        end_time=row.finished_at,
    )


class TestApplicationTraceHandoffCases:
    @staticmethod
    def test_chatflow_message_event_is_not_exported_again(sqlite_session_factory: sessionmaker[Session]) -> None:
        case = setup(sqlite_session_factory, "chatflow", AppMode.ADVANCED_CHAT, snapshot=False)
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
        assert run_count(case.collection.sessions) == 1

    @staticmethod
    @pytest.mark.parametrize("mode", [AppMode.AGENT, AppMode.ADVANCED_CHAT])
    def test_snapshot_failure_is_persisted_and_never_falls_back(
        sqlite_session_factory: sessionmaker[Session], mode: AppMode
    ) -> None:
        case = setup(sqlite_session_factory, "failure", mode, snapshot=False)
        failing = handoff(
            case.collection, _FreezeFails(sqlite_session_factory, TracingStoreUnavailableError()), no_egress()
        )
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
        assert RuntimeApplicationTracingHooks(failing.service).prepare_agent_app(context) is None
        destination = no_egress()
        deliver(failing, message_event(failing), destination)
        assert destination.requests == []
        stored = case.collection.repository.source_run(
            tenant_id=case.collection.run.tenant_id,
            app_id=case.collection.run.app_id,
            source_kind="message",
            source_id=case.collection.run.source_id,
        )
        assert stored is not None
        assert stored.state is TraceRunState.FAILED
        assert stored.error_code == "tracing_initialization_failed"
        assert stored.provider_config == {}

    @staticmethod
    @pytest.mark.parametrize("mode", [AppMode.AGENT, AppMode.ADVANCED_CHAT, AppMode.CHAT])
    @pytest.mark.parametrize("kind", ["title", "moderation", "aliased_moderation"])
    def test_auxiliary_events_resolve_owner_without_bypassing_content_policy(
        sqlite_session_factory: sessionmaker[Session], mode: AppMode, kind: str
    ) -> None:
        case = setup(sqlite_session_factory, "aux", mode, snapshot=False)
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
        deliver(case, trace_event(case.collection.run, payload), destination)
        assert len(destination.requests) == (1 if mode is AppMode.CHAT else 0)
        assert case.scheduled == []
        assert run_count(case.collection.sessions) == 0

    @staticmethod
    def test_plain_nested_workflow_hangs_from_the_tool_node_of_its_parent(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        parent_case = setup(sqlite_session_factory, "plain-parent", AppMode.WORKFLOW, snapshot=False)
        parent, _ = workflow(parent_case, "plain-parent", has_agent=False, snapshot=False)
        tool_node(parent_case, parent)
        child_case = setup(sqlite_session_factory, "plain-child", AppMode.WORKFLOW, snapshot=False)
        child, _ = workflow(child_case, "plain-child", has_agent=False, snapshot=False)
        add_app_owner(child_case.collection, "plain-child")
        event = workflow_event(child, parent)
        record = record_source(sqlite_session_factory).assemble(event)
        assert isinstance(record, WorkflowTraceInfo)
        assert child_case.service.capture_terminal(tenant_id=child.tenant_id, info=record) is False
        assert (
            child_case.service.collected_trace(
                tenant_id=parent.tenant_id, app_id=parent.app_id, workflow_run_id=parent.id
            )
            is None
        )
        destination = exported()
        deliver(child_case, event, destination)
        root = nested_root(destination, trace_id_for(parent.id), child)
        metadata = root["metadata"]
        assert isinstance(metadata, dict)
        assert metadata["parent_workflow_run_id"] == parent.id
        assert metadata["parent_node_execution_id"] == identifier("parent-tool-node")
        assert run_count(sqlite_session_factory) == 0

    @staticmethod
    def test_plain_chatflow_auxiliary_events_keep_the_provider_route(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        case = setup(sqlite_session_factory, "plain-chatflow", AppMode.ADVANCED_CHAT, snapshot=False)
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
        deliver(case, trace_event(case.collection.run, payload), destination)
        assert len(destination.requests) == 1

    @staticmethod
    def test_provider_exported_child_of_a_collected_parent_hangs_in_its_agent_trace(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        parent_case = setup(sqlite_session_factory, "managed-parent", AppMode.WORKFLOW, snapshot=False)
        parent, parent_trace = workflow(parent_case, "managed-parent", has_agent=True, snapshot=True)
        assert parent_trace is not None
        tool_node(parent_case, parent)
        child_case = setup(sqlite_session_factory, "provider-child", AppMode.WORKFLOW, snapshot=False)
        child, _ = workflow(child_case, "provider-child", has_agent=False, snapshot=False)
        collected = child_case.service.collected_trace(
            tenant_id=parent.tenant_id, app_id=parent.app_id, workflow_run_id=parent.id
        )
        assert collected is not None
        assert collected.trace_id == parent_trace.trace_id
        assert collected.destination is not None
        assert collected.destination.provider_id == parent_trace.provider
        add_app_owner(child_case.collection, "provider-child")
        destination = exported()
        deliver(child_case, workflow_event(child, parent), destination)
        nested_root(destination, parent_trace.trace_id, child)

    @staticmethod
    def test_a_collected_parent_lends_no_trace_before_its_collection_starts(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        parent_case = setup(sqlite_session_factory, "pending-parent", AppMode.WORKFLOW, snapshot=False)
        parent, _ = workflow(parent_case, "pending-parent", has_agent=True, snapshot=False)

        collected = parent_case.service.collected_trace(
            tenant_id=parent.tenant_id, app_id=parent.app_id, workflow_run_id=parent.id
        )

        assert collected is not None
        assert (collected.trace_id, collected.destination) == (None, None)

    @staticmethod
    def test_collector_database_failure_redelivers_without_provider_fallback(
        sqlite_session_factory: sessionmaker[Session], tmp_path: Path
    ) -> None:
        case = setup(sqlite_session_factory, "collector-unavailable", AppMode.AGENT, snapshot=True)
        # The ledger's database cannot be opened while the business records stay readable.
        unreachable = create_engine(URL.create("sqlite", database=str(tmp_path / "missing" / "ledger.sqlite3")))
        destination = no_egress()
        try:
            collector = handoff(
                case.collection, ApplicationTraceRepository(sessionmaker(bind=unreachable)), no_egress()
            )
            with pytest.raises(TraceCollectorUnavailableError):
                deliver(collector, message_event(case), destination)
        finally:
            unreachable.dispose()
        assert destination.requests == []

    @staticmethod
    def test_mixed_workflow_exports_normal_llm_and_agent_calls_without_double_usage(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        case = setup(sqlite_session_factory, "mixed", AppMode.WORKFLOW, snapshot=False)
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
        with case.collection.repository.change(managed.id) as locked:
            assert locked is not None
            invocation = locked.run.open_invocation(
                agent_id=identifier("agent"), node_execution_id=agent_node_id, attempt=0, call_key="agent:0"
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
        ingest(
            case.collection.repository,
            AgentTraceBatch(
                run_id=UUID(managed.id), invocation_id=UUID(invocation.id), batch_id=uuid4(), final=True, spans=spans
            ),
            max_spans=100,
            max_bytes=100000,
        )
        record = record_source(sqlite_session_factory).assemble(workflow_event(row, None))
        assert isinstance(record, WorkflowTraceInfo)
        assert case.service.capture_terminal(tenant_id=row.tenant_id, info=record) is True
        assert case.scheduled == [managed.id]
        destination = exported()
        handoff(case.collection, case.collection.repository, destination).service.deliver(managed.id)
        delivered = case.collection.repository.get(managed.id)
        assert delivered is not None
        assert delivered.state is TraceRunState.ACCEPTED
        assert [request.url for request in destination.requests] == ["https://langfuse.test/api/public/ingestion"]
        generations = [item["body"] for item in ingested(destination) if item["type"] == "generation-create"]
        usages = [body["usage"] for body in generations if isinstance(body, dict)]
        assert len(usages) == 3
        assert sum(usage["total"] for usage in usages) == 25
        assert sum(usage["totalCost"] for usage in usages) == pytest.approx(0.04)


"""Verify execution hook ownership, policy gating, and fail-open business behavior."""


@dataclass(frozen=True)
class Bridge:
    sessions: sessionmaker[Session]
    traces: ApplicationTraceRepository
    hooks: RuntimeApplicationTracingHooks

    def run(self, *, app_id: str, source_kind: TraceSourceKind, source_id: str) -> TraceRun:
        """The run frozen for a source of the bridge's workspace."""
        run = self.traces.source_run(tenant_id="tenant", app_id=app_id, source_kind=source_kind, source_id=source_id)
        assert run is not None
        return run


def bridge_hooks(
    sessions: sessionmaker[Session], traces: ApplicationTraceRepository, settings: AgentTraceSettings
) -> RuntimeApplicationTracingHooks:
    return RuntimeApplicationTracingHooks(tracing_service(sessions, traces, no_egress(), [], settings))


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


def workflow_agent_context(preview: bool) -> WorkflowAgentRuntimeBuildContext:
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


def workflow_entity(extras: dict[str, object]) -> WorkflowAppGenerateEntity:
    return WorkflowAppGenerateEntity.model_construct(
        app_config=WorkflowUIBasedAppConfig(
            app_id="workflow-app", tenant_id="tenant", app_mode=AppMode.WORKFLOW, workflow_id="workflow"
        ),
        extras=extras,
    )


class TestRuntimeBridgeCases:
    @staticmethod
    @pytest.fixture
    def bridge(sqlite_session_factory: sessionmaker[Session]) -> Bridge:
        """An Agent app with one message and a workflow app with an Agent node, both tracing their content."""
        with sqlite_session_factory.begin() as session:
            for app_id, mode in (("agent-app", AppMode.AGENT), ("workflow-app", AppMode.WORKFLOW)):
                session.add(
                    make_app(
                        app_id=app_id,
                        tenant_id="tenant",
                        mode=mode,
                        tracing=json.dumps({"enabled": True, "tracing_provider": "langfuse", "capture_content": True}),
                    )
                )
                session.add(
                    TraceAppConfig(
                        app_id=app_id,
                        tracing_provider="langfuse",
                        tracing_config=langfuse_config("tenant", "https://langfuse.test"),
                    )
                )
            session.add(
                make_workflow(workflow_id="workflow", tenant_id="tenant", app_id="workflow-app", graph=AGENT_GRAPH)
            )
            session.add(
                make_conversation(
                    conversation_id="conversation",
                    app_id="agent-app",
                    mode=AppMode.AGENT,
                    inputs={},
                    from_source=ConversationFromSource.CONSOLE,
                )
            )
            session.add(
                make_message(
                    message_id="message-id",
                    app_id="agent-app",
                    conversation_id="conversation",
                    inputs={},
                    query="query",
                    message={},
                    answer="",
                    message_unit_price=Decimal(0),
                    answer_unit_price=Decimal(0),
                    currency="USD",
                    from_source=ConversationFromSource.CONSOLE,
                )
            )
        traces = ApplicationTraceRepository(sqlite_session_factory)
        return Bridge(
            sqlite_session_factory, traces, bridge_hooks(sqlite_session_factory, traces, AGENT_TRACE_SETTINGS)
        )

    @staticmethod
    def test_disabled_deployment_binds_no_hooks_and_never_freezes_a_run(bridge: Bridge) -> None:
        # The composition root binds no hooks when the deployment does not collect Agent traces.
        application = Flask(__name__)
        bind_tracing(application, scopes=trace_scopes(bridge.sessions), hooks=None)
        with application.app_context():
            assert application_tracing_hooks() is None
        disabled = bridge_hooks(bridge.sessions, bridge.traces, replace(AGENT_TRACE_SETTINGS, enabled=False))
        assert disabled.prepare_agent_app(agent_context()) is None
        assert disabled.prepare_workflow_agent(workflow_agent_context(False), None) is None
        disabled.freeze_workflow_run(
            workflow_entity({}),
            workflow_id="workflow",
            workflow_run_id="run",
            conversation_id=None,
            graph_data=AGENT_GRAPH,
        )
        assert run_count(bridge.sessions) == 0

    @staticmethod
    def test_agent_app_uses_message_identity_and_stable_conversation(bridge: Bridge) -> None:
        runtime = bridge.hooks.prepare_agent_app(agent_context())
        run = bridge.run(app_id="agent-app", source_kind="message", source_id="message-id")
        assert run.session_id == "conversation"
        [invocation] = bridge.traces.invocations(run.id)
        assert (invocation.agent_id, invocation.node_execution_id, invocation.attempt) == ("agent", None, 0)
        # The message is the call key, so a redelivered request reuses its invocation.
        assert invocation.id == str(uuid5(UUID(run.id), "message-id"))
        assert runtime == ApplicationTracingContext(
            run_id=UUID(run.id),
            invocation_id=UUID(invocation.id),
            trace_id=run.trace_id,
            parent_span_id=invocation.span_id,
            session_id="conversation",
            capture_content=True,
        )

    @staticmethod
    @pytest.mark.parametrize("preview", [False, True])
    def test_workflow_invocation_uses_owner_app_and_execution_attempt(bridge: Bridge, preview: bool) -> None:
        # Neither source row exists yet: only the workflow the hook passes lets the ledger reserve the run.
        runtime = bridge.hooks.prepare_workflow_agent(workflow_agent_context(preview), None)
        source_kind: TraceSourceKind = "node" if preview else "workflow"
        source_id = "node-execution" if preview else "run"
        run = bridge.run(app_id="workflow-app", source_kind=source_kind, source_id=source_id)
        assert run.session_id == source_id
        [invocation] = bridge.traces.invocations(run.id)
        assert (invocation.agent_id, invocation.node_execution_id, invocation.attempt) == (
            "referenced-agent",
            "node-execution",
            2,
        )
        assert invocation.id == str(uuid5(UUID(run.id), "node-execution:2"))
        assert invocation.parent_span_id == span_id_for("node-execution")
        assert runtime is not None
        assert (runtime.run_id, runtime.invocation_id) == (UUID(run.id), UUID(invocation.id))

    @staticmethod
    def test_workflow_start_prefers_explicit_trace_session(bridge: Bridge) -> None:
        bridge.hooks.freeze_workflow_run(
            workflow_entity({"trace_session_id": "external-session"}),
            workflow_id="workflow",
            workflow_run_id="run",
            conversation_id="conversation",
            graph_data={"nodes": [{"data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"}}]},
        )
        run = bridge.run(app_id="workflow-app", source_kind="workflow", source_id="run")
        assert run.session_id == "external-session"
        assert run.state is TraceRunState.COLLECTING

    @staticmethod
    def test_business_hook_failure_logs_type_without_sensitive_exception_message(
        bridge: Bridge, caplog: pytest.LogCaptureFixture
    ) -> None:
        failing = _FreezeFails(bridge.sessions, ValueError("password=private-secret"))
        hooks = bridge_hooks(bridge.sessions, failing, AGENT_TRACE_SETTINGS)
        assert hooks.prepare_agent_app(agent_context()) is None
        assert "ValueError" in caplog.text
        assert "private-secret" not in caplog.text

    @staticmethod
    def test_ordinary_workflow_does_not_create_managed_snapshot(bridge: Bridge) -> None:
        bridge.hooks.freeze_workflow_run(
            workflow_entity({}),
            workflow_id="workflow",
            workflow_run_id="run",
            conversation_id=None,
            graph_data={"nodes": [{"data": {"type": "llm"}}, {"data": {"type": "agent", "version": "1"}}]},
        )
        assert run_count(bridge.sessions) == 0

    @staticmethod
    @pytest.mark.parametrize(
        "graph", ["not-json", "null", "[]", {}, {"nodes": {}}, {"nodes": [None, {"data": {"type": "llm"}}]}]
    )
    def test_invalid_or_ordinary_graph_cannot_enable_agent_collection(graph: object) -> None:
        assert workflow_has_agent_v2(graph) is False

    @staticmethod
    def test_graph_string_with_agent_is_recognized() -> None:
        assert (
            workflow_has_agent_v2('{"nodes":[{"data":{"type":"agent","version":"2","agent_node_kind":"dify_agent"}}]}')
            is True
        )

    @staticmethod
    @pytest.mark.parametrize("outcome", ["succeeded", "failed", "cancelled"])
    def test_worker_terminal_handoff_preserves_outcome_without_sse(
        bridge: Bridge, outcome: Literal["succeeded", "failed", "cancelled"]
    ) -> None:
        started = tracing_service(bridge.sessions, bridge.traces, no_egress(), [], AGENT_TRACE_SETTINGS).start(
            tenant_id="tenant",
            app_id="agent-app",
            source_kind="message",
            source_id="message-id",
            session_id="conversation",
            workflow_id=None,
        )
        assert started is not None
        bridge.hooks.capture_agent_app_terminal(
            tenant_id="tenant",
            app_id="agent-app",
            message_id="message-id",
            output="answer",
            outcome=outcome,
        )
        stored = bridge.traces.get(started.id)
        assert stored is not None
        root = Trace.model_validate(stored.outer_trace).root
        assert root.attributes["message_execution_state"] == outcome
        assert root.status is (SpanStatus.OK if outcome == "succeeded" else SpanStatus.ERROR)
        assert root.outputs == "answer"

    @staticmethod
    def test_terminal_handoff_fail_open_log_redacts_sensitive_details(
        bridge: Bridge, caplog: pytest.LogCaptureFixture
    ) -> None:
        bridge.hooks.capture_agent_app_terminal(
            tenant_id="tenant",
            app_id="agent-app",
            message_id="missing-message",
            outcome="failed",
            output="private-content",
        )
        assert "tracing_source_not_found" in caplog.text
        assert "private-content" not in caplog.text

    @staticmethod
    def test_workflow_fail_open_logs_error_kind_without_content(
        bridge: Bridge, caplog: pytest.LogCaptureFixture
    ) -> None:
        failing = _FreezeFails(bridge.sessions, ValueError("private-prompt"))
        hooks = bridge_hooks(bridge.sessions, failing, AGENT_TRACE_SETTINGS)
        assert hooks.prepare_workflow_agent(workflow_agent_context(False), "conversation") is None
        hooks.freeze_workflow_run(
            workflow_entity({}),
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
    def test_hooks_expose_only_the_agent_collection_lifecycle(bridge: Bridge) -> None:
        assert {name for name in dir(bridge.hooks) if not name.startswith("_")} == {
            "prepare_agent_app",
            "prepare_workflow_agent",
            "freeze_workflow_run",
            "capture_agent_app_terminal",
        }
        application = Flask(__name__)
        bind_tracing(application, scopes=trace_scopes(bridge.sessions), hooks=bridge.hooks)
        with application.app_context():
            assert application_tracing_hooks() is bridge.hooks


"""Hidden Workflow Tool Agents must not invent a trace owned by the source app."""


def _workflow_tool_tracing_boundary_seed(
    sessions: sessionmaker[Session], *, root_has_agent: bool, source_enabled: bool
) -> tuple[
    ApplicationTraceRepository, RuntimeApplicationTracingHooks, WorkflowAgentRuntimeBuildContext, dict[str, str]
]:
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
    configs = {
        "root": langfuse_config(ids["tenant"], "https://tracing.test/root"),
        "source": {
            "api_key": WorkspaceBoundCipher().encrypt(ids["tenant"], "secret"),
            "project": "source",
            "endpoint": "https://tracing.test/source",
        },
    }
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
            session.add(TraceAppConfig(app_id=ids[app], tracing_provider=provider, tracing_config=configs[app]))
        workflow_record = WorkflowRun(
            id=ids["run"],
            tenant_id=ids["tenant"],
            app_id=ids["root"],
            workflow_id=ids["root_workflow"],
            type=WorkflowType.WORKFLOW,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
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
    traces = ApplicationTraceRepository(sessions)
    hooks = bridge_hooks(sessions, traces, AGENT_TRACE_SETTINGS)
    entity = workflow_entity({})
    entity.app_config = entity.app_config.model_copy(
        update={"app_id": ids["root"], "tenant_id": ids["tenant"], "workflow_id": ids["root_workflow"]}
    )
    hooks.freeze_workflow_run(
        entity,
        workflow_id=ids["root_workflow"],
        workflow_run_id=ids["run"],
        conversation_id=None,
        graph_data=root_graph,
    )
    original = workflow_agent_context(False)
    context = replace(
        original,
        dify_context=original.dify_context.model_copy(
            update={"tenant_id": ids["tenant"], "app_id": ids["source"], "workflow_tool_invocation_id": "tool-call"}
        ),
        workflow_id=ids["source_workflow"],
        workflow_run_id=ids["run"],
        node_execution_id=ids["child"],
    )
    return traces, hooks, context, ids


class TestWorkflowToolTracingBoundaryCases:
    @staticmethod
    @pytest.mark.parametrize("root_has_agent", [False, True])
    @pytest.mark.parametrize("source_enabled", [False, True])
    def test_hidden_child_never_reserves_source_policy_or_changes_root_freeze(
        sqlite_engine: Engine,
        sqlite_session_factory: sessionmaker[Session],
        root_has_agent: bool,
        source_enabled: bool,
    ) -> None:
        traces, hooks, context, ids = _workflow_tool_tracing_boundary_seed(
            sqlite_session_factory, root_has_agent=root_has_agent, source_enabled=source_enabled
        )
        with sqlite_session_factory() as session:
            before = deepcopy([dict(row) for row in session.execute(select(ApplicationTraceRun.__table__)).mappings()])
        statements: list[str] = []

        def executed(
            _connection: object,
            _cursor: object,
            statement: str,
            _parameters: object,
            _context: object,
            _executemany: object,
        ) -> None:
            statements.append(statement)

        # Marked children never consult policy or ownership, even for malformed
        # empty markers or a foreign tenant. They cannot create an orphan B run.
        event.listen(sqlite_engine, "before_cursor_execute", executed)
        try:
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
                    assert hooks.prepare_workflow_agent(child, None) is None
        finally:
            event.remove(sqlite_engine, "before_cursor_execute", executed)
        assert statements == []
        with sqlite_session_factory() as session:
            observed = [
                (r.app_id, r.provider, r.capture_content, r.source_id)
                for r in session.scalars(select(ApplicationTraceRun))
            ]
            assert observed == ([(ids["root"], "langfuse", False, ids["run"])] if root_has_agent else [])
            after = [dict(row) for row in session.execute(select(ApplicationTraceRun.__table__)).mappings()]
        assert after == before
        assert (
            traces.source_run(
                tenant_id=ids["tenant"], app_id=ids["source"], source_kind="workflow", source_id=ids["run"]
            )
            is None
        )

    @staticmethod
    def test_hidden_child_skip_keeps_normal_root_agent_trace_assemblable(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        traces, hooks, child, ids = _workflow_tool_tracing_boundary_seed(
            sqlite_session_factory, root_has_agent=True, source_enabled=True
        )
        assert hooks.prepare_workflow_agent(child, None) is None
        root_context = replace(
            child,
            dify_context=child.dify_context.model_copy(
                update={"app_id": ids["root"], "workflow_tool_invocation_id": None}
            ),
            workflow_id=ids["root_workflow"],
            node_execution_id=ids["root_agent"],
        )
        runtime = hooks.prepare_workflow_agent(root_context, None)
        assert runtime is not None
        run = traces.get(str(runtime.run_id))
        assert run is not None
        assert run.app_id == ids["root"]
        frozen = deepcopy(run.provider_config)
        with sqlite_session_factory.begin() as session:
            owner = session.get(App, ids["root"])
            assert owner is not None
            owner.tracing = json.dumps({"enabled": True, "tracing_provider": "langsmith", "capture_content": True})
            workflow = session.get(WorkflowRun, ids["run"])
            assert workflow is not None
        assert workflow.finished_at is not None
        actor = make_account(account_id=ids["actor"])
        nodes = SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id=ids["tenant"],
            user=actor,
            app_id=ids["root"],
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )
        info = WorkflowTraceInfo(
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
            parent=None,
            metadata={"app_id": ids["root"]},
            start_time=workflow.created_at,
            end_time=workflow.finished_at,
        )
        outer = CanonicalTraceBuilder().build(info)
        assert outer is not None
        capture(traces, run.id, outer)
        [invocation] = traces.invocations(run.id)
        ingest(
            traces,
            AgentTraceBatch(
                run_id=UUID(run.id),
                invocation_id=UUID(invocation.id),
                batch_id=uuid4(),
                final=True,
                spans=[
                    AgentTraceSpan(
                        trace_id=run.trace_id,
                        span_id="a" * 16,
                        parent_span_id=invocation.span_id,
                        name="Agent execution",
                        start_time_ns=1_000_000_000,
                        end_time_ns=2_000_000_000,
                        status="ok",
                        attributes={"gen_ai.operation.name": "invoke_agent"},
                    )
                ],
            ),
            max_spans=100,
            max_bytes=1_000_000,
        )
        destination = exported()
        tracing_service(sqlite_session_factory, traces, destination, [], AGENT_TRACE_SETTINGS).deliver(run.id)
        current = traces.get(run.id)
        assert current is not None
        # Assembly rejects any span whose parent is missing, so acceptance proves a complete tree.
        assert current.state is TraceRunState.ACCEPTED
        assert [request.url for request in destination.requests] == ["https://tracing.test/root/api/public/ingestion"]
        sent = observations(destination)
        emitted = {body["id"] for body in sent}
        assert all(body["parentObservationId"] in emitted for body in sent if "parentObservationId" in body)
        assert current.provider_config == frozen
        assert current.provider == "langfuse"
        assert current.capture_content is False
