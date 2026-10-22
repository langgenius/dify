"""SQLite ownership regressions at the actual legacy-task handoff boundary."""

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID, uuid4

import httpx
import pytest
from dify_agent.protocol.tracing import AgentTraceBatch, AgentTraceSpan
from flask import Flask
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from sqlalchemy import delete, func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.agent_app.runtime_request_builder import AgentAppRuntimeBuildContext
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.ops.base_trace_instance import bind_application_tracing_hooks
from core.ops.entities.trace_entity import (
    BaseTraceInfo,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    WorkflowTraceInfo,
)
from core.ops.ops_trace_manager import OpsTraceManager
from extensions.ext_database import db
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from models.agent_config_entities import AgentSoulConfig
from models.application_trace import ApplicationTraceRun
from models.enums import ConversationFromSource, CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import App, AppMode, Message
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom, WorkflowRun, WorkflowType
from services.tracing import runtime_bridge
from services.tracing.provider_dispatch import export_trace
from services.tracing.service import ApplicationTracingService
from tasks import ops_trace_task
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_account, make_conversation, make_workflow
from tests.unit_tests.services.tracing.test_application_trace_collection import Collection, identifier, seed, terminal

AGENT_GRAPH = {
    "nodes": [{"id": "agent", "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"}}],
    "edges": list[object](),
}


@dataclass
class Case:
    collection: Collection
    service: ApplicationTracingService
    scheduled: list[str]


def setup(
    sessions: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, name: str, mode: AppMode, *, snapshot: bool
) -> Case:
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
    collection = seed(sessions, name)
    with sessions.begin() as session:
        app = session.get(App, collection.run.app_id)
        message = session.get(Message, collection.run.source_id)
        assert app is not None
        assert message is not None
        app.mode = mode
        session.add(
            make_conversation(
                conversation_id=message.conversation_id,
                app_id=app.id,
                mode=mode,
                inputs={},
                from_source=ConversationFromSource.CONSOLE,
            )
        )
        if not snapshot:
            session.execute(delete(ApplicationTraceRun).where(ApplicationTraceRun.id == collection.run.id))
    service = ApplicationTracingService(collection.repository)
    scheduled: list[str] = []
    monkeypatch.setattr(service, "schedule", scheduled.append)
    monkeypatch.setattr(runtime_bridge, "_service", lambda: service)
    return Case(collection, service, scheduled)


def message_info(case: Case) -> MessageTraceInfo:
    with case.collection.sessions() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        return MessageTraceInfo(
            metadata={"app_id": message.app_id},
            message_id=message.id,
            message_data=message.to_dict(session=session),
            conversation_model="agent",
            conversation_mode="agent",
            message_tokens=0,
            answer_tokens=0,
            total_tokens=0,
            inputs="private input",
            outputs="private output",
        )


def dispatch(case: Case, info: BaseTraceInfo, monkeypatch: pytest.MonkeyPatch) -> list[BaseTraceInfo]:
    calls: list[BaseTraceInfo] = []
    failures: list[str] = []

    class Legacy:
        def trace(self, restored: BaseTraceInfo) -> None:
            calls.append(restored)

    payload = json.dumps({"trace_info_type": type(info).__name__, "trace_info": info.model_dump(mode="json")})
    monkeypatch.setattr(ops_trace_task.storage, "load", lambda _path: payload)
    monkeypatch.setattr(ops_trace_task.storage, "delete", lambda _path: None)
    monkeypatch.setattr(ops_trace_task.redis_client, "incr", failures.append)
    monkeypatch.setattr(OpsTraceManager, "get_ops_trace_instance", lambda _app: Legacy())
    monkeypatch.setattr("extensions.ext_enterprise_telemetry.is_enabled", lambda: False)
    app = Flask(__name__)
    bind_application_tracing_hooks(app, runtime_bridge.RuntimeApplicationTracingHooks())
    with app.app_context():
        ops_trace_task.process_trace_tasks.run({"app_id": case.collection.run.app_id, "file_id": "fixture"})
    assert failures == []
    return calls


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


def workflow_info(row: WorkflowRun, parent: WorkflowRun | None = None) -> WorkflowTraceInfo:
    metadata: dict[str, object] = {"app_id": row.app_id}
    if parent is not None:
        metadata["parent_trace_context"] = {
            "parent_workflow_run_id": parent.id,
            "parent_node_execution_id": identifier("parent-tool-node"),
        }
    return WorkflowTraceInfo(
        workflow_data=row,
        workflow_id=row.workflow_id,
        tenant_id=row.tenant_id,
        workflow_run_id=row.id,
        workflow_run_elapsed_time=2,
        workflow_run_status="succeeded",
        workflow_run_inputs={},
        workflow_run_outputs={},
        workflow_run_version="1",
        total_tokens=0,
        file_list=[],
        query="",
        metadata=metadata,
        start_time=row.created_at,
        end_time=row.finished_at,
    )


def test_chatflow_message_event_cannot_export_again_via_legacy(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    case = setup(sqlite_session_factory, monkeypatch, "chatflow", AppMode.ADVANCED_CHAT, snapshot=False)
    row, trace_run = workflow(case, "chatflow", has_agent=True, snapshot=True)
    assert trace_run is not None
    terminal(Collection(case.collection.repository, case.collection.sessions, trace_run))
    before = case.collection.repository.get(trace_run.id)
    assert before is not None
    with case.collection.sessions.begin() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        message.workflow_run_id = row.id
    assert dispatch(case, message_info(case), monkeypatch) == []
    after = case.collection.repository.get(trace_run.id)
    assert after is not None
    assert after.outer_trace == before.outer_trace
    assert case.scheduled == []
    with case.collection.sessions() as session:
        assert session.scalar(select(func.count()).select_from(ApplicationTraceRun)) == 1


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
    assert dispatch(case, message_info(case), monkeypatch) == []
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
    with case.collection.sessions() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        if kind == "title":
            info: BaseTraceInfo = GenerateNameTraceInfo(
                tenant_id=case.collection.run.tenant_id,
                conversation_id=message.conversation_id,
                metadata={"conversation_id": message.conversation_id},
                inputs="private conversation",
                outputs="private generated title",
            )
        else:
            info = ModerationTraceInfo(
                message_id=identifier("workflow-app-log") if kind == "aliased_moderation" else message.id,
                message_data=message.to_dict(session=session),
                metadata={"message_id": message.id},
                flagged=False,
                action="direct_output",
                preset_response="",
                query="private prompt",
                inputs="private prompt",
                outputs="private output",
            )
    legacy = dispatch(case, info, monkeypatch)
    assert len(legacy) == (1 if mode is AppMode.CHAT else 0)
    assert case.scheduled == []


def test_plain_workflow_preserves_legacy_parent_context(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    parent_case = setup(sqlite_session_factory, monkeypatch, "plain-parent", AppMode.WORKFLOW, snapshot=False)
    parent, _ = workflow(parent_case, "plain-parent", has_agent=False, snapshot=False)
    child_case = setup(sqlite_session_factory, monkeypatch, "plain-child", AppMode.WORKFLOW, snapshot=False)
    child, _ = workflow(child_case, "plain-child", has_agent=False, snapshot=False)
    info = workflow_info(child, parent)
    original = dict(info.metadata)
    assert child_case.service.capture_terminal(info) is False
    assert info.metadata == original
    with child_case.collection.sessions() as session:
        assert session.scalar(select(func.count()).select_from(ApplicationTraceRun)) == 0


def test_plain_chatflow_auxiliary_events_keep_the_legacy_route(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    case = setup(sqlite_session_factory, monkeypatch, "plain-chatflow", AppMode.ADVANCED_CHAT, snapshot=False)
    row, _ = workflow(case, "plain-chatflow", has_agent=False, snapshot=False)
    with case.collection.sessions.begin() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        message.workflow_run_id = row.id
        info = GenerateNameTraceInfo(
            tenant_id=row.tenant_id,
            conversation_id=message.conversation_id,
            metadata={"conversation_id": message.conversation_id},
            inputs="legacy input",
            outputs="legacy title",
        )
    assert len(dispatch(case, info, monkeypatch)) == 1


def test_legacy_child_of_managed_parent_uses_explicit_link_not_unavailable_context(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    parent_case = setup(sqlite_session_factory, monkeypatch, "managed-parent", AppMode.WORKFLOW, snapshot=False)
    parent, parent_trace = workflow(parent_case, "managed-parent", has_agent=True, snapshot=True)
    assert parent_trace is not None
    child_case = setup(sqlite_session_factory, monkeypatch, "legacy-child", AppMode.WORKFLOW, snapshot=False)
    child, _ = workflow(child_case, "legacy-child", has_agent=False, snapshot=False)
    info = workflow_info(child, parent)
    assert child_case.service.capture_terminal(info) is False
    assert info.resolved_parent_context == (None, None)
    assert info.metadata["linked_parent_workflow_run_id"] == parent.id
    assert info.metadata["linked_parent_node_execution_id"] == identifier("parent-tool-node")
    assert info.metadata["linked_parent_application_trace_id"] == parent_trace.id
    assert info.metadata["linked_parent_trace_id"] == parent_trace.trace_id


def test_mixed_workflow_exports_normal_llm_and_agent_calls_without_double_usage(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    case = setup(sqlite_session_factory, monkeypatch, "mixed", AppMode.WORKFLOW, snapshot=False)
    row, managed = workflow(case, "mixed", has_agent=True, snapshot=True)
    assert managed is not None
    agent_node_id = identifier("agent-execution")
    owner = identifier("mixed-owner")
    with case.collection.sessions.begin() as session:
        app = session.get(App, row.app_id)
        assert app is not None
        app.created_by = owner
        session.add(make_account(account_id=owner))
        for index, kind in enumerate(("llm", "agent")):
            node_id = identifier("normal-execution") if kind == "llm" else agent_node_id
            usage: dict[str, int] = (
                {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15} if kind == "llm" else {}
            )
            trace_node_record = WorkflowNodeExecutionModel(
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
            trace_node_record.created_at = row.created_at
            session.add(trace_node_record)
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
    monkeypatch.setattr(type(db), "engine", property(lambda _db: sqlite_session_factory.kw["bind"]))
    assert case.service.capture_terminal(workflow_info(row)) is True
    stored = case.collection.repository.get(managed.id)
    assert stored is not None
    trace = case.service.assemble(stored)
    payloads: list[ExportTraceServiceRequest] = []

    def send(method: str, url: str, **kwargs: object) -> httpx.Response:
        body = kwargs["content"]
        assert isinstance(body, bytes)
        payloads.append(ExportTraceServiceRequest.FromString(body))
        return httpx.Response(200, content=b"", request=httpx.Request(method, url))

    monkeypatch.setattr("core.helper.ssrf_proxy.make_request", send)
    export_trace("langfuse", {"host": "https://langfuse.test", "public_key": "pk", "secret_key": "sk"}, trace)
    observations = payloads[0].resource_spans[0].scope_spans[0].spans
    attributes = [{item.key: item.value.string_value for item in span.attributes} for span in observations]
    generations = [item for item in attributes if item["langfuse.observation.type"] == "generation"]
    assert len(generations) == 3
    assert sum(json.loads(item["langfuse.observation.usage_details"])["total"] for item in generations) == 25
    assert sum(json.loads(item["langfuse.observation.cost_details"])["total"] for item in generations) == pytest.approx(
        0.04
    )
