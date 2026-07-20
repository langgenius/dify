from typing import cast

import pytest
from agenton.compositor import CompositorSessionSnapshot
from agenton.compositor.schemas import LayerSessionSnapshot
from agenton.layers.base import LifecycleState
from dify_agent.protocol import RuntimeLayerSpec

from core.workflow.nodes.agent_v2.session_cleanup_layer import (
    WorkflowAgentSessionCleanupLayer,
    build_workflow_agent_session_cleanup_layer,
)
from core.workflow.nodes.agent_v2.session_store import (
    StoredWorkflowAgentSession,
    WorkflowAgentRuntimeSessionStore,
    WorkflowAgentSessionScope,
)
from core.workflow.system_variables import build_system_variables
from graphon.entities.pause_reason import SchedulingPause
from graphon.graph_engine.command_channels import CommandChannel
from graphon.graph_events import (
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
)
from graphon.runtime import GraphRuntimeState, ReadOnlyGraphRuntimeStateWrapper, VariablePool


def _layer_snapshot(name: str) -> LayerSessionSnapshot:
    return LayerSessionSnapshot(
        name=name,
        lifecycle_state=LifecycleState.SUSPENDED,
        runtime_state={},
    )


def _default_scope() -> WorkflowAgentSessionScope:
    return WorkflowAgentSessionScope(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_run_id="workflow-run-1",
        node_id="agent-node",
        node_execution_id="node-exec-1",
        binding_id="binding-1",
        agent_id="agent-1",
        agent_config_snapshot_id="snapshot-1",
    )


def _stored_session(scope: WorkflowAgentSessionScope, *, index: int = 1) -> StoredWorkflowAgentSession:
    return StoredWorkflowAgentSession(
        scope=scope,
        session_snapshot=CompositorSessionSnapshot(
            layers=[
                _layer_snapshot("workflow_node_job_prompt"),
                _layer_snapshot("execution_context"),
                _layer_snapshot("history"),
                _layer_snapshot("llm"),
            ]
        ),
        backend_run_id=f"agent-run-{index}",
        runtime_layer_specs=[
            RuntimeLayerSpec(name="workflow_node_job_prompt", type="plain.prompt", config={"prefix": "ok"}),
            RuntimeLayerSpec(name="execution_context", type="dify.execution_context", config={"tenant_id": "t"}),
            RuntimeLayerSpec(name="history", type="pydantic_ai.history"),
        ],
    )


class FakeSessionStore:
    def __init__(self, *, stored: list[StoredWorkflowAgentSession] | None = None) -> None:
        self._stored = stored if stored is not None else [_stored_session(_default_scope())]
        self.list_calls: list[str] = []
        self.cleaned: list[tuple[WorkflowAgentSessionScope, str | None]] = []

    def list_active_sessions(self, *, workflow_run_id: str) -> list[StoredWorkflowAgentSession]:
        self.list_calls.append(workflow_run_id)
        return list(self._stored)

    def mark_cleaned(self, *, scope: WorkflowAgentSessionScope, backend_run_id: str | None = None) -> None:
        self.cleaned.append((scope, backend_run_id))


def _build_layer(*, session_store: FakeSessionStore) -> WorkflowAgentSessionCleanupLayer:
    variable_pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(workflow_execution_id="workflow-run-1"),
        user_inputs={},
        conversation_variables=[],
    )
    runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)
    layer = WorkflowAgentSessionCleanupLayer(
        session_store=cast(WorkflowAgentRuntimeSessionStore, session_store),
    )
    layer.initialize(ReadOnlyGraphRuntimeStateWrapper(runtime_state), cast(CommandChannel, object()))
    return layer


@pytest.mark.parametrize(
    "terminal_event",
    [
        GraphRunSucceededEvent(outputs={}),
        GraphRunPartialSucceededEvent(exceptions_count=1, outputs={}),
        GraphRunFailedEvent(error="boom"),
        GraphRunAbortedEvent(reason="user cancelled", outputs={}),
    ],
    ids=["succeeded", "partial_succeeded", "failed", "aborted"],
)
def test_cleanup_layer_enqueues_cleanup_and_marks_cleaned_on_terminal_events(monkeypatch, terminal_event):
    session_store = FakeSessionStore()
    queued_payloads: list[dict[str, object]] = []
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_cleanup_layer.cleanup_workflow_agent_runtime_session.delay",
        lambda payload: queued_payloads.append(payload),
    )
    layer = _build_layer(session_store=session_store)

    layer.on_event(terminal_event)

    assert session_store.list_calls == ["workflow-run-1"]
    assert len(queued_payloads) == 1
    assert queued_payloads[0]["metadata"]["workflow_run_id"] == "workflow-run-1"
    assert queued_payloads[0]["metadata"]["previous_agent_backend_run_id"] == "agent-run-1"
    assert session_store.cleaned == [(_default_scope(), "agent-run-1")]


@pytest.mark.parametrize(
    "non_terminal_event",
    [
        GraphRunStartedEvent(),
        GraphRunPausedEvent(reasons=[SchedulingPause(message="awaiting human input")], outputs={}),
    ],
    ids=["started", "paused"],
)
def test_cleanup_layer_ignores_non_terminal_events(monkeypatch, non_terminal_event):
    session_store = FakeSessionStore()
    queued_payloads: list[dict[str, object]] = []
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_cleanup_layer.cleanup_workflow_agent_runtime_session.delay",
        lambda payload: queued_payloads.append(payload),
    )
    layer = _build_layer(session_store=session_store)

    layer.on_event(non_terminal_event)

    assert session_store.list_calls == []
    assert queued_payloads == []
    assert session_store.cleaned == []


def test_cleanup_layer_marks_cleaned_even_when_specs_are_missing(monkeypatch, caplog: pytest.LogCaptureFixture):
    scope = _default_scope()
    session_store = FakeSessionStore(
        stored=[
            StoredWorkflowAgentSession(
                scope=scope,
                session_snapshot=CompositorSessionSnapshot(layers=[_layer_snapshot("history")]),
                backend_run_id="legacy-run",
                runtime_layer_specs=[],
            )
        ]
    )
    queued_payloads: list[dict[str, object]] = []
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_cleanup_layer.cleanup_workflow_agent_runtime_session.delay",
        lambda payload: queued_payloads.append(payload),
    )
    layer = _build_layer(session_store=session_store)

    layer.on_event(GraphRunSucceededEvent(outputs={}))

    assert queued_payloads == []
    assert session_store.cleaned == [(scope, "legacy-run")]
    assert any("no runtime_layer_specs persisted" in record.message for record in caplog.records)


def test_cleanup_layer_marks_cleaned_even_when_enqueue_fails(monkeypatch):
    session_store = FakeSessionStore()

    def _explode(_payload: dict[str, object]) -> None:
        raise RuntimeError("queue down")

    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_cleanup_layer.cleanup_workflow_agent_runtime_session.delay",
        _explode,
    )
    layer = _build_layer(session_store=session_store)

    layer.on_event(GraphRunSucceededEvent(outputs={}))

    assert session_store.cleaned == [(_default_scope(), "agent-run-1")]


def test_cleanup_layer_does_not_raise_when_mark_cleaned_fails(monkeypatch):
    session_store = FakeSessionStore()

    def _explode(*, scope: WorkflowAgentSessionScope, backend_run_id: str | None = None) -> None:
        del scope, backend_run_id
        raise RuntimeError("cleanup bookkeeping failed")

    monkeypatch.setattr(session_store, "mark_cleaned", _explode)
    layer = _build_layer(session_store=session_store)

    layer.on_event(GraphRunSucceededEvent(outputs={}))


def test_cleanup_layer_fans_out_to_every_active_session(monkeypatch):
    scopes = [
        WorkflowAgentSessionScope(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_run_id="workflow-run-1",
            node_id=f"agent-node-{i}",
            node_execution_id=f"node-exec-{i}",
            binding_id=f"binding-{i}",
            agent_id=f"agent-{i}",
            agent_config_snapshot_id=f"snapshot-{i}",
        )
        for i in range(3)
    ]
    session_store = FakeSessionStore(stored=[_stored_session(scope, index=i) for i, scope in enumerate(scopes, 1)])
    queued_payloads: list[dict[str, object]] = []
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_cleanup_layer.cleanup_workflow_agent_runtime_session.delay",
        lambda payload: queued_payloads.append(payload),
    )
    layer = _build_layer(session_store=session_store)

    layer.on_event(GraphRunSucceededEvent(outputs={}))

    assert len(queued_payloads) == 3
    assert [entry[0] for entry in session_store.cleaned] == scopes


def test_cleanup_layer_skips_when_workflow_run_id_missing(caplog: pytest.LogCaptureFixture):
    session_store = FakeSessionStore()
    variable_pool = VariablePool.from_bootstrap(system_variables={}, user_inputs={}, conversation_variables=[])
    runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)
    layer = WorkflowAgentSessionCleanupLayer(session_store=cast(WorkflowAgentRuntimeSessionStore, session_store))
    layer.initialize(ReadOnlyGraphRuntimeStateWrapper(runtime_state), cast(CommandChannel, object()))

    layer.on_event(GraphRunSucceededEvent(outputs={}))

    assert session_store.list_calls == []
    assert session_store.cleaned == []
    assert any("workflow_run_id is missing" in record.message for record in caplog.records)


def test_build_workflow_agent_session_cleanup_layer_returns_layer() -> None:
    layer = build_workflow_agent_session_cleanup_layer()

    assert isinstance(layer, WorkflowAgentSessionCleanupLayer)
