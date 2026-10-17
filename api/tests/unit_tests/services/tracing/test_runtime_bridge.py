"""Verify execution hook ownership, policy gating, and fail-open business behavior."""

from dataclasses import dataclass, field
from typing import cast
from uuid import uuid4

import pytest
from dify_agent.layers.execution_context import ApplicationTracingContext
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.agent_app.runtime_request_builder import AgentAppRuntimeBuildContext
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom, WorkflowAppGenerateEntity
from core.ops.entities.trace_entity import BaseTraceInfo
from core.ops.exceptions import RetryableTraceDispatchError
from core.workflow.nodes.agent_v2.runtime_request_builder import WorkflowAgentRuntimeBuildContext
from graphon.runtime import VariablePool
from models.agent import Agent, AgentConfigSnapshot, WorkflowAgentNodeBinding
from models.agent_config_entities import AgentSoulConfig
from models.model import AppMode
from repositories.application_trace_repository import ApplicationTraceRepository
from services.tracing import runtime_bridge
from services.tracing.service import ApplicationTracingService
from tests.unit_tests.config_override import apply_config_overrides


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


def workflow_context(preview: bool) -> WorkflowAgentRuntimeBuildContext:
    return WorkflowAgentRuntimeBuildContext(
        dify_context=run_context("workflow-app"),
        agent=Agent(id="referenced-agent", tenant_id="tenant", name="Agent"),
        snapshot=AgentConfigSnapshot(
            id="snapshot", tenant_id="tenant", agent_id="referenced-agent", version=1, config_snapshot=AgentSoulConfig()
        ),
        binding=WorkflowAgentNodeBinding(
            id="binding",
            tenant_id="tenant",
            app_id="workflow-app",
            workflow_id="workflow",
            node_id="node",
            agent_id="referenced-agent",
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


def workflow_entity(extras: dict[str, object] | None = None) -> WorkflowAppGenerateEntity:
    return WorkflowAppGenerateEntity.model_construct(
        app_config=WorkflowUIBasedAppConfig(
            app_id="app", tenant_id="tenant", app_mode=AppMode.WORKFLOW, workflow_id="workflow"
        ),
        extras=extras or {},
    )


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


@pytest.mark.parametrize("preview", [False, True])
def test_workflow_invocation_uses_owner_app_and_execution_attempt(service: BridgeCase, preview: bool) -> None:
    assert runtime_bridge.prepare_workflow_agent(workflow_context(preview), None) is service.context
    values = service.calls[0][1]
    assert values["app_id"] == "workflow-app"
    assert values["agent_id"] == "referenced-agent"
    assert values["source_kind"] == ("node" if preview else "workflow")
    assert values["source_id"] == ("node-execution" if preview else "run")
    assert values["session_id"] == values["source_id"]
    assert values["call_key"] == "node-execution:2"
    assert values["workflow_id"] == "workflow"


def test_workflow_start_prefers_explicit_trace_session(service: BridgeCase) -> None:
    entity = workflow_entity({"trace_session_id": "external-session"})
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


def test_business_hook_failure_logs_type_without_sensitive_exception_message(
    service: BridgeCase, caplog: pytest.LogCaptureFixture
) -> None:
    service.failure = ValueError("password=private-secret")
    assert runtime_bridge.prepare_agent_app(agent_context()) is None
    assert "ValueError" in caplog.text
    assert "private-secret" not in caplog.text


def test_worker_database_failure_retries_without_legacy_fallback(service: BridgeCase) -> None:
    service.failure = OperationalError("statement", {}, Exception("sensitive database error"))
    with pytest.raises(RetryableTraceDispatchError, match="persistence temporarily unavailable"):
        runtime_bridge.capture_terminal(cast(BaseTraceInfo, object()))


def test_ordinary_workflow_does_not_create_managed_snapshot(service: BridgeCase) -> None:
    runtime_bridge.freeze_workflow_run(
        cast(WorkflowAppGenerateEntity, object()),
        workflow_id="workflow",
        workflow_run_id="run",
        conversation_id=None,
        graph_data={"nodes": [{"data": {"type": "llm"}}, {"data": {"type": "agent", "version": "1"}}]},
    )
    assert service.calls == []


@pytest.mark.parametrize(
    "graph", ["not-json", "null", "[]", {}, {"nodes": {}}, {"nodes": [None, {"data": {"type": "llm"}}]}]
)
def test_invalid_or_ordinary_graph_cannot_enable_agent_collection(graph: object) -> None:
    assert runtime_bridge.workflow_has_agent_v2(graph) is False


def test_graph_string_with_agent_is_recognized() -> None:
    assert (
        runtime_bridge.workflow_has_agent_v2(
            '{"nodes":[{"data":{"type":"agent","version":"2","agent_node_kind":"dify_agent"}}]}'
        )
        is True
    )


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


def test_workflow_fail_open_logs_error_kind_without_content(
    service: BridgeCase, caplog: pytest.LogCaptureFixture
) -> None:
    service.failure = ValueError("private-prompt")
    assert runtime_bridge.prepare_workflow_agent(workflow_context(False), "conversation") is None
    runtime_bridge.freeze_workflow_run(
        workflow_entity(),
        workflow_id="workflow",
        workflow_run_id="run",
        conversation_id="conversation",
        graph_data={"nodes": [{"data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"}}]},
    )
    assert "workflow_agent" in caplog.text
    assert "workflow_start" in caplog.text
    assert "ValueError" in caplog.text
    assert "private-prompt" not in caplog.text


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
    from tests.unit_tests.model_factories import make_app

    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
    with sqlite_session_factory.begin() as session:
        session.add(make_app(app_id="queue-app", tenant_id="tenant", tracing=policy))
    with sqlite_session_factory() as session:
        monkeypatch.setattr(db, "session", session)
        assert runtime_bridge.queue_enabled_at_start("queue-app") is expected
        assert runtime_bridge.queue_enabled_at_start("missing") is False
        assert runtime_bridge.queue_enabled_at_start(None) is False
    assert "invalid-private" not in caplog.text
