from typing import cast

import pytest
from agenton.compositor import CompositorSessionSnapshot
from agenton.compositor.schemas import LayerSessionSnapshot
from agenton.layers.base import LifecycleState
from dify_agent.protocol import RuntimeLayerSpec
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from core.db import session_factory as session_factory_module
from core.workflow.nodes.agent_v2.session_cleanup_layer import (
    WorkflowAgentSessionCleanupLayer,
    build_workflow_agent_session_cleanup_layer,
)
from core.workflow.nodes.agent_v2.session_store import (
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
from models.agent import WorkflowAgentRuntimeSession, WorkflowAgentRuntimeSessionStatus

pytestmark = pytest.mark.parametrize("sqlite_session", [(WorkflowAgentRuntimeSession,)], indirect=True)


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


def _save_session(
    session_store: WorkflowAgentRuntimeSessionStore,
    scope: WorkflowAgentSessionScope,
    *,
    index: int = 1,
    runtime_layer_specs: list[RuntimeLayerSpec] | None = None,
) -> None:
    session_store.save_active_snapshot(
        scope=scope,
        snapshot=CompositorSessionSnapshot(
            layers=[
                _layer_snapshot("workflow_node_job_prompt"),
                _layer_snapshot("execution_context"),
                _layer_snapshot("history"),
                _layer_snapshot("llm"),
            ]
        ),
        backend_run_id=f"agent-run-{index}",
        runtime_layer_specs=(
            runtime_layer_specs
            if runtime_layer_specs is not None
            else [
                RuntimeLayerSpec(name="workflow_node_job_prompt", type="plain.prompt", config={"prefix": "ok"}),
                RuntimeLayerSpec(name="execution_context", type="dify.execution_context", config={"tenant_id": "t"}),
                RuntimeLayerSpec(name="history", type="pydantic_ai.history"),
            ]
        ),
    )


@pytest.fixture(autouse=True)
def _bind_session_factory(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    monkeypatch.setattr(
        session_factory_module,
        "_session_maker",
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
    )


def _build_layer(*, session_store: WorkflowAgentRuntimeSessionStore) -> WorkflowAgentSessionCleanupLayer:
    variable_pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(workflow_execution_id="workflow-run-1"),
        user_inputs={},
        conversation_variables=[],
    )
    runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)
    layer = WorkflowAgentSessionCleanupLayer(session_store=session_store)
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
def test_cleanup_layer_enqueues_cleanup_and_marks_cleaned_on_terminal_events(
    monkeypatch: pytest.MonkeyPatch,
    terminal_event,
    sqlite_session: Session,
):
    session_store = WorkflowAgentRuntimeSessionStore()
    _save_session(session_store, _default_scope())
    queued_payloads: list[dict[str, object]] = []
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_cleanup_layer.cleanup_workflow_agent_runtime_session.delay",
        lambda payload: queued_payloads.append(payload),
    )
    layer = _build_layer(session_store=session_store)

    layer.on_event(terminal_event)

    assert len(queued_payloads) == 1
    assert queued_payloads[0]["metadata"]["workflow_run_id"] == "workflow-run-1"
    assert queued_payloads[0]["metadata"]["previous_agent_backend_run_id"] == "agent-run-1"
    sqlite_session.expire_all()
    row = sqlite_session.scalar(select(WorkflowAgentRuntimeSession))
    assert row is not None
    assert row.status == WorkflowAgentRuntimeSessionStatus.CLEANED
    assert row.backend_run_id == "agent-run-1"
    assert row.cleaned_at is not None


@pytest.mark.parametrize(
    "non_terminal_event",
    [
        GraphRunStartedEvent(),
        GraphRunPausedEvent(reasons=[SchedulingPause(message="awaiting human input")], outputs={}),
    ],
    ids=["started", "paused"],
)
def test_cleanup_layer_ignores_non_terminal_events(
    monkeypatch: pytest.MonkeyPatch,
    non_terminal_event,
    sqlite_session: Session,
):
    session_store = WorkflowAgentRuntimeSessionStore()
    _save_session(session_store, _default_scope())
    queued_payloads: list[dict[str, object]] = []
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_cleanup_layer.cleanup_workflow_agent_runtime_session.delay",
        lambda payload: queued_payloads.append(payload),
    )
    layer = _build_layer(session_store=session_store)

    layer.on_event(non_terminal_event)

    assert queued_payloads == []
    row = sqlite_session.scalar(select(WorkflowAgentRuntimeSession))
    assert row is not None
    assert row.status == WorkflowAgentRuntimeSessionStatus.ACTIVE
    assert row.cleaned_at is None


def test_cleanup_layer_marks_cleaned_even_when_specs_are_missing(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    sqlite_session: Session,
):
    scope = _default_scope()
    session_store = WorkflowAgentRuntimeSessionStore()
    _save_session(session_store, scope, runtime_layer_specs=[])
    queued_payloads: list[dict[str, object]] = []
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_cleanup_layer.cleanup_workflow_agent_runtime_session.delay",
        lambda payload: queued_payloads.append(payload),
    )
    layer = _build_layer(session_store=session_store)

    layer.on_event(GraphRunSucceededEvent(outputs={}))

    assert queued_payloads == []
    sqlite_session.expire_all()
    row = sqlite_session.scalar(select(WorkflowAgentRuntimeSession))
    assert row is not None
    assert row.status == WorkflowAgentRuntimeSessionStatus.CLEANED
    assert any("no runtime_layer_specs persisted" in record.message for record in caplog.records)


def test_cleanup_layer_marks_cleaned_even_when_enqueue_fails(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
    session_store = WorkflowAgentRuntimeSessionStore()
    _save_session(session_store, _default_scope())

    def _explode(_payload: dict[str, object]) -> None:
        raise RuntimeError("queue down")

    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_cleanup_layer.cleanup_workflow_agent_runtime_session.delay",
        _explode,
    )
    layer = _build_layer(session_store=session_store)

    layer.on_event(GraphRunSucceededEvent(outputs={}))

    sqlite_session.expire_all()
    row = sqlite_session.scalar(select(WorkflowAgentRuntimeSession))
    assert row is not None
    assert row.status == WorkflowAgentRuntimeSessionStatus.CLEANED


def test_cleanup_layer_does_not_raise_when_mark_cleaned_fails(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session: Session,
):
    session_store = WorkflowAgentRuntimeSessionStore()
    _save_session(session_store, _default_scope())
    queued_payloads: list[dict[str, object]] = []
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_cleanup_layer.cleanup_workflow_agent_runtime_session.delay",
        lambda payload: queued_payloads.append(payload),
    )

    def _fail_update(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
        if statement.lstrip().upper().startswith("UPDATE"):
            raise RuntimeError("cleanup bookkeeping failed")

    event.listen(sqlite_engine, "before_cursor_execute", _fail_update)
    layer = _build_layer(session_store=session_store)

    try:
        layer.on_event(GraphRunSucceededEvent(outputs={}))
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", _fail_update)

    assert len(queued_payloads) == 1
    sqlite_session.expire_all()
    row = sqlite_session.scalar(select(WorkflowAgentRuntimeSession))
    assert row is not None
    assert row.status == WorkflowAgentRuntimeSessionStatus.ACTIVE


def test_cleanup_layer_fans_out_to_every_active_session(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
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
    session_store = WorkflowAgentRuntimeSessionStore()
    for i, scope in enumerate(scopes, 1):
        _save_session(session_store, scope, index=i)
    queued_payloads: list[dict[str, object]] = []
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_cleanup_layer.cleanup_workflow_agent_runtime_session.delay",
        lambda payload: queued_payloads.append(payload),
    )
    layer = _build_layer(session_store=session_store)

    layer.on_event(GraphRunSucceededEvent(outputs={}))

    assert len(queued_payloads) == 3
    sqlite_session.expire_all()
    rows = sqlite_session.scalars(select(WorkflowAgentRuntimeSession)).all()
    assert len(rows) == 3
    assert all(row.status == WorkflowAgentRuntimeSessionStatus.CLEANED for row in rows)


def test_cleanup_layer_skips_when_workflow_run_id_missing(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    sqlite_session: Session,
):
    session_store = WorkflowAgentRuntimeSessionStore()
    _save_session(session_store, _default_scope())
    queued_payloads: list[dict[str, object]] = []
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_cleanup_layer.cleanup_workflow_agent_runtime_session.delay",
        lambda payload: queued_payloads.append(payload),
    )
    variable_pool = VariablePool.from_bootstrap(system_variables={}, user_inputs={}, conversation_variables=[])
    runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)
    layer = WorkflowAgentSessionCleanupLayer(session_store=session_store)
    layer.initialize(ReadOnlyGraphRuntimeStateWrapper(runtime_state), cast(CommandChannel, object()))

    layer.on_event(GraphRunSucceededEvent(outputs={}))

    assert queued_payloads == []
    row = sqlite_session.scalar(select(WorkflowAgentRuntimeSession))
    assert row is not None
    assert row.status == WorkflowAgentRuntimeSessionStatus.ACTIVE
    assert any("workflow_run_id is missing" in record.message for record in caplog.records)


def test_build_workflow_agent_session_cleanup_layer_returns_layer() -> None:
    layer = build_workflow_agent_session_cleanup_layer()

    assert isinstance(layer, WorkflowAgentSessionCleanupLayer)
