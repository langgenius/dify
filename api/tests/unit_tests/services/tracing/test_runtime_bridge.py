import json
from copy import deepcopy
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID, uuid4

import httpx
import pytest
from dify_agent.layers.execution_context import ApplicationTracingContext
from dify_agent.protocol.tracing import AgentTraceBatch, AgentTraceSpan
from flask import Flask
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from sqlalchemy import delete, func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.agent_app.runtime_request_builder import AgentAppRuntimeBuildContext
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom, WorkflowAppGenerateEntity
from core.ops.base_trace_instance import bind_application_tracing_hooks
from core.ops.entities.trace_entity import (
    BaseTraceInfo,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    WorkflowTraceInfo,
)
from core.ops.exceptions import RetryableTraceDispatchError
from core.ops.ops_trace_manager import OpsTraceManager
from core.ops.unified_trace.trace_builder import CanonicalTraceBuilder
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.nodes.agent_v2.runtime_request_builder import WorkflowAgentRuntimeBuildContext
from extensions.ext_database import db
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from graphon.enums import WorkflowType as _workflow_tool_tracing_boundary_WorkflowType
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
from models.enums import ConversationFromSource, CreatorUserRole
from models.enums import WorkflowRunTriggeredFrom as _application_trace_handoff_WorkflowRunTriggeredFrom
from models.model import App, AppMode, Message, TraceAppConfig
from models.workflow import (
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
)
from models.workflow import (
    WorkflowRunTriggeredFrom as _workflow_tool_tracing_boundary_WorkflowRunTriggeredFrom,
)
from models.workflow import WorkflowType as _application_trace_handoff_WorkflowType
from repositories.application_trace_repository import ApplicationTraceRepository
from services.tracing import runtime_bridge
from services.tracing.normalization import remap_outer_trace
from services.tracing.provider_dispatch import export_trace
from services.tracing.service import ApplicationTracingService
from tasks import ops_trace_task
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_account, make_app, make_conversation, make_workflow
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_batch_for as batch_for
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_identifier as identifier
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_ingest as ingest
from tests.unit_tests.services.tracing.test_service import (
    _application_trace_collection_seed as _application_trace_handoff_seed,
)
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_terminal as terminal
from tests.unit_tests.services.tracing.test_service import _ApplicationTraceCollectionCollection as Collection

"""SQLite ownership regressions at the actual legacy-task handoff boundary."""


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
    collection = _application_trace_handoff_seed(sessions, name)
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
            type=_application_trace_handoff_WorkflowType.WORKFLOW,
            version="1",
            graph=json.dumps(graph),
            inputs="{}",
            outputs="{}",
            status=WorkflowExecutionStatus.SUCCEEDED,
            triggered_from=_application_trace_handoff_WorkflowRunTriggeredFrom.APP_RUN,
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


class TestApplicationTraceHandoffCases:
    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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
        assert sum(
            json.loads(item["langfuse.observation.cost_details"])["total"] for item in generations
        ) == pytest.approx(0.04)


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
        target = ApplicationTracingService(ApplicationTraceRepository(sqlite_session_factory))
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

        def terminal(_info: BaseTraceInfo) -> bool:
            if case.failure is not None:
                raise case.failure
            return True

        def agent_terminal(**values: object) -> None:
            if case.failure is not None:
                raise case.failure
            case.calls.append(("terminal", values))

        monkeypatch.setattr(target, "prepare_invocation", prepare)
        monkeypatch.setattr(target, "start", start)
        monkeypatch.setattr(target, "capture_terminal", terminal)
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
        assert runtime_bridge.capture_terminal(cast(BaseTraceInfo, object())) is False
        assert runtime_bridge.queue_enabled_at_start("app") is False
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
    def test_worker_database_failure_retries_without_legacy_fallback(service: BridgeCase) -> None:
        service.failure = OperationalError("statement", {}, Exception("sensitive database error"))
        with pytest.raises(RetryableTraceDispatchError, match="persistence temporarily unavailable"):
            runtime_bridge.capture_terminal(cast(BaseTraceInfo, object()))

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
        from typing import Literal, cast

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
        from repositories.application_trace_repository import TraceCollectionError

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
    @pytest.mark.parametrize(
        ("policy", "expected"),
        [
            (None, False),
            ('{"enabled":true}', True),
            ('{"enabled":"true"}', False),
            ("[]", False),
            ("invalid-private", False),
        ],
    )
    def test_queue_policy_reads_real_app_rows_without_constructing_vendor_sdk(
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        policy: str | None,
        expected: bool,
    ) -> None:
        from extensions.ext_database import db
        from tests.helpers.unit.model_factories import make_app

        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
        with sqlite_session_factory.begin() as session:
            session.add(make_app(app_id="queue-app", tenant_id="tenant", tracing=policy))
        with sqlite_session_factory() as session:
            monkeypatch.setattr(db, "session", session)
            assert runtime_bridge.queue_enabled_at_start("queue-app") is expected
            assert runtime_bridge.queue_enabled_at_start("missing") is False
            assert runtime_bridge.queue_enabled_at_start(None) is False
        assert "invalid-private" not in caplog.text


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
        session.add(
            WorkflowRun(
                id=ids["run"],
                tenant_id=ids["tenant"],
                app_id=ids["root"],
                workflow_id=ids["root_workflow"],
                type=_workflow_tool_tracing_boundary_WorkflowType.WORKFLOW,
                triggered_from=_workflow_tool_tracing_boundary_WorkflowRunTriggeredFrom.APP_RUN,
                version="1",
                graph=json.dumps(root_graph),
                inputs="{}",
                status=WorkflowExecutionStatus.SUCCEEDED,
                created_by=ids["actor"],
                created_by_role=CreatorUserRole.ACCOUNT,
                created_at=now,
                finished_at=now + timedelta(seconds=3),
            )
        )
        for key, node_type in [("root_agent", "agent"), ("root_tool", "tool"), ("child", "agent")]:
            child = key == "child"
            app = "source" if child else "root"
            session.add(
                WorkflowNodeExecutionModel(
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
                    created_at=now,
                    finished_at=now + timedelta(seconds=2),
                    inputs="{}",
                    outputs="{}",
                    process_data=json.dumps(
                        {"workflow_tool_root_app_id": ids["root"], "workflow_tool_invocation_id": "tool-call"}
                    )
                    if child
                    else "{}",
                )
            )
    service = ApplicationTracingService(ApplicationTraceRepository(sessions))
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
            workflow_id=ids["root_workflow"],
            tenant_id=ids["tenant"],
            workflow_run_id=ids["run"],
            workflow_run_elapsed_time=3,
            workflow_run_status="succeeded",
            workflow_run_inputs={},
            workflow_run_outputs={},
            workflow_run_version="1",
            total_tokens=0,
            file_list=[],
            query="",
            metadata={"app_id": ids["root"]},
        )
        outer = CanonicalTraceBuilder(lambda _info: nodes.get_by_workflow_execution(ids["run"])).build(info)
        assert outer is not None
        outer = remap_outer_trace(outer, trace_id=run.trace_id, capture_content=False, agent_message=False)
        service.repository.terminal(run.id, outer.model_dump(mode="json"), outer.root_span_id)
        invocation = service.repository.collected(run.id)[0][0]
        ingest(Collection(service.repository, sqlite_session_factory, run), batch_for(run, invocation))
        current = service.repository.get(run.id)
        assert current is not None
        trace = service.assemble(current)
        span_ids = {span.id for span in trace.spans}
        assert all(span.parent_id is None or span.parent_id in span_ids for span in trace.spans)
        assert current.provider_config == frozen
        assert current.provider == "langfuse"
        assert current.capture_content is False
