"""Verify execution hook ownership, policy gating, and fail-open business behavior."""

from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest
from dify_agent.layers.execution_context import ApplicationTracingContext
from sqlalchemy.exc import OperationalError

from core.app.apps.agent_app.runtime_request_builder import AgentAppRuntimeBuildContext
from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
from core.ops.entities.trace_entity import BaseTraceInfo
from core.ops.exceptions import RetryableTraceDispatchError
from core.workflow.nodes.agent_v2.runtime_request_builder import WorkflowAgentRuntimeBuildContext
from services.tracing import runtime_bridge
from services.tracing.service import ApplicationTracingService
from tests.unit_tests.config_override import apply_config_overrides


class RecordingService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.failure: Exception | None = None
        self.context = ApplicationTracingContext(
            run_id=uuid4(),
            invocation_id=uuid4(),
            trace_id="1" * 32,
            parent_span_id="2" * 16,
            session_id="session",
            capture_content=False,
        )

    def prepare_invocation(self, **values: object) -> ApplicationTracingContext:
        if self.failure is not None:
            raise self.failure
        self.calls.append(("prepare", values))
        return self.context

    def start(self, **values: object) -> None:
        self.calls.append(("start", values))

    def capture_terminal(self, _info: BaseTraceInfo) -> bool:
        if self.failure is not None:
            raise self.failure
        return True


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch) -> RecordingService:
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
    recorder = RecordingService()
    monkeypatch.setattr(runtime_bridge, "_service", lambda: cast(ApplicationTracingService, recorder))
    return recorder


def agent_context() -> AgentAppRuntimeBuildContext:
    return cast(
        AgentAppRuntimeBuildContext,
        SimpleNamespace(
            dify_context=SimpleNamespace(tenant_id="tenant", app_id="agent-app", trace_session_id=None),
            agent_id="agent",
            idempotency_key="message-id",
            conversation_id="conversation",
        ),
    )


def workflow_context(preview: bool) -> WorkflowAgentRuntimeBuildContext:
    return cast(
        WorkflowAgentRuntimeBuildContext,
        SimpleNamespace(
            dify_context=SimpleNamespace(tenant_id="tenant", app_id="workflow-app", trace_session_id=None),
            agent=SimpleNamespace(id="referenced-agent"),
            workflow_id="workflow",
            workflow_run_id=None if preview else "run",
            node_execution_id="node-execution",
            attempt=2,
        ),
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
        cast(WorkflowAppGenerateEntity, object()), workflow_id="workflow", workflow_run_id="run", conversation_id=None
    )
    assert runtime_bridge.capture_terminal(cast(BaseTraceInfo, object())) is False
    assert runtime_bridge.queue_enabled_at_start("app") is False
    assert calls == []


def test_agent_app_uses_message_identity_and_stable_conversation(service: RecordingService) -> None:
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
def test_workflow_invocation_uses_owner_app_and_execution_attempt(service: RecordingService, preview: bool) -> None:
    assert runtime_bridge.prepare_workflow_agent(workflow_context(preview), None) is service.context
    values = service.calls[0][1]
    assert values["app_id"] == "workflow-app"
    assert values["agent_id"] == "referenced-agent"
    assert values["source_kind"] == ("node" if preview else "workflow")
    assert values["source_id"] == ("node-execution" if preview else "run")
    assert values["session_id"] == values["source_id"]
    assert values["call_key"] == "node-execution:2"
    assert values["workflow_id"] == "workflow"


def test_workflow_start_prefers_explicit_trace_session(service: RecordingService) -> None:
    entity = WorkflowAppGenerateEntity.model_construct(
        app_config=SimpleNamespace(app_id="app", tenant_id="tenant"), extras={"trace_session_id": "external-session"}
    )
    runtime_bridge.freeze_workflow_run(
        entity, workflow_id="workflow", workflow_run_id="run", conversation_id="conversation"
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
    service: RecordingService, caplog: pytest.LogCaptureFixture
) -> None:
    service.failure = ValueError("password=private-secret")
    assert runtime_bridge.prepare_agent_app(agent_context()) is None
    assert "ValueError" in caplog.text
    assert "private-secret" not in caplog.text


def test_worker_database_failure_retries_without_legacy_fallback(service: RecordingService) -> None:
    service.failure = OperationalError("statement", {}, Exception("sensitive database error"))
    with pytest.raises(RetryableTraceDispatchError, match="persistence temporarily unavailable"):
        runtime_bridge.capture_terminal(cast(BaseTraceInfo, object()))
