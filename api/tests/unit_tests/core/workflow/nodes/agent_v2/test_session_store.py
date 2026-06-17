"""Unit tests for :mod:`core.workflow.nodes.agent_v2.session_store`.

Uses the in-memory SQLite engine configured by the project conftest plus a
per-test ``CREATE TABLE`` so the real ORM round-trip exercises every store
method. Keeps the suite self-contained — no Postgres / Docker required — while
still hitting the actual ``session_factory`` code path that production uses.
"""

from __future__ import annotations

from collections.abc import Generator

import pytest
from agenton.compositor import CompositorSessionSnapshot
from agenton.compositor.schemas import LayerSessionSnapshot
from agenton.layers.base import LifecycleState
from dify_agent.protocol import RuntimeLayerSpec
from sqlalchemy import delete

from core.db.session_factory import session_factory
from core.workflow.nodes.agent_v2.session_store import (
    StoredWorkflowAgentSession,
    WorkflowAgentRuntimeSessionStore,
    WorkflowAgentSessionScope,
)
from models.agent import WorkflowAgentRuntimeSession, WorkflowAgentRuntimeSessionStatus


def _scope(workflow_run_id: str | None = "wfr-1", binding_id: str = "binding-1") -> WorkflowAgentSessionScope:
    return WorkflowAgentSessionScope(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_run_id=workflow_run_id,
        node_id="agent-node",
        node_execution_id="node-exec-1",
        binding_id=binding_id,
        agent_id="agent-1",
        agent_config_snapshot_id="snapshot-1",
    )


def _snapshot(messages: int = 1) -> CompositorSessionSnapshot:
    return CompositorSessionSnapshot(
        layers=[
            LayerSessionSnapshot(
                name="history",
                lifecycle_state=LifecycleState.SUSPENDED,
                runtime_state={"messages": [{"role": "user", "content": f"m{i}"} for i in range(messages)]},
            )
        ]
    )


def _specs() -> list[RuntimeLayerSpec]:
    return [
        RuntimeLayerSpec(name="workflow_node_job_prompt", type="plain.prompt", config={"prefix": "ok"}),
        RuntimeLayerSpec(name="history", type="pydantic_ai.history"),
    ]


@pytest.fixture(autouse=True)
def _create_table() -> Generator[None, None, None]:
    """Create the lifecycle table on the in-memory SQLite engine, drop after."""
    engine = session_factory.get_session_maker().kw["bind"]
    WorkflowAgentRuntimeSession.__table__.create(bind=engine, checkfirst=True)
    yield
    with session_factory.create_session() as session:
        session.execute(delete(WorkflowAgentRuntimeSession))
        session.commit()
    WorkflowAgentRuntimeSession.__table__.drop(bind=engine, checkfirst=True)


def test_load_active_snapshot_returns_none_when_scope_has_no_workflow_run_id():
    """``workflow_run_id`` is the keying column; no row can match without it."""
    store = WorkflowAgentRuntimeSessionStore()
    assert store.load_active_snapshot(_scope(workflow_run_id=None)) is None


def test_load_active_snapshot_returns_none_when_no_row_matches():
    store = WorkflowAgentRuntimeSessionStore()
    assert store.load_active_snapshot(_scope()) is None


def test_save_active_snapshot_creates_row_and_load_round_trips():
    store = WorkflowAgentRuntimeSessionStore()
    snapshot = _snapshot(messages=2)
    store.save_active_snapshot(scope=_scope(), backend_run_id="run-1", snapshot=snapshot, runtime_layer_specs=_specs())

    loaded = store.load_active_snapshot(_scope())
    assert loaded is not None
    assert len(loaded.layers) == 1
    assert loaded.layers[0].name == "history"
    assert loaded.layers[0].runtime_state["messages"] == snapshot.layers[0].runtime_state["messages"]
    with session_factory.create_session() as session:
        row = session.query(WorkflowAgentRuntimeSession).one()
        assert "workflow_node_job_prompt" in row.composition_layer_specs
        assert "history" in row.composition_layer_specs


def test_save_active_snapshot_skips_when_workflow_run_id_missing():
    """Without a workflow_run_id the row cannot be keyed; save is a no-op."""
    store = WorkflowAgentRuntimeSessionStore()
    store.save_active_snapshot(
        scope=_scope(workflow_run_id=None),
        backend_run_id="run-skipped",
        snapshot=_snapshot(),
        runtime_layer_specs=_specs(),
    )
    with session_factory.create_session() as session:
        assert session.query(WorkflowAgentRuntimeSession).count() == 0


def test_save_active_snapshot_skips_when_snapshot_missing():
    """A run that produced no snapshot (e.g. failed agent run) does not write."""
    store = WorkflowAgentRuntimeSessionStore()
    store.save_active_snapshot(
        scope=_scope(),
        backend_run_id="run-empty",
        snapshot=None,
        runtime_layer_specs=_specs(),
    )
    with session_factory.create_session() as session:
        assert session.query(WorkflowAgentRuntimeSession).count() == 0


def test_save_active_snapshot_updates_existing_row_on_re_entry():
    """A second save under the same scope must update in place, not insert."""
    store = WorkflowAgentRuntimeSessionStore()
    store.save_active_snapshot(
        scope=_scope(),
        backend_run_id="run-1",
        snapshot=_snapshot(messages=1),
        runtime_layer_specs=_specs(),
    )
    # Second call with new snapshot + backend_run_id.
    store.save_active_snapshot(
        scope=_scope(),
        backend_run_id="run-2",
        snapshot=_snapshot(messages=2),
        runtime_layer_specs=_specs(),
    )

    with session_factory.create_session() as session:
        rows = session.query(WorkflowAgentRuntimeSession).all()
        assert len(rows) == 1
        assert rows[0].backend_run_id == "run-2"
        assert rows[0].status == WorkflowAgentRuntimeSessionStatus.ACTIVE
        assert rows[0].cleaned_at is None


def test_save_active_snapshot_resurrects_cleaned_row():
    """If a prior cleanup retired the row, a re-entry flips it back to ACTIVE."""
    store = WorkflowAgentRuntimeSessionStore()
    store.save_active_snapshot(
        scope=_scope(),
        backend_run_id="run-1",
        snapshot=_snapshot(),
        runtime_layer_specs=_specs(),
    )
    store.mark_cleaned(scope=_scope(), backend_run_id="cleanup-1")
    # Save again — the existing row was CLEANED; should be revived.
    store.save_active_snapshot(
        scope=_scope(),
        backend_run_id="run-2",
        snapshot=_snapshot(messages=3),
        runtime_layer_specs=_specs(),
    )

    with session_factory.create_session() as session:
        rows = session.query(WorkflowAgentRuntimeSession).all()
        assert len(rows) == 1
        assert rows[0].status == WorkflowAgentRuntimeSessionStatus.ACTIVE
        assert rows[0].cleaned_at is None
        assert rows[0].backend_run_id == "run-2"


def test_list_active_sessions_returns_specs_and_snapshot():
    store = WorkflowAgentRuntimeSessionStore()
    store.save_active_snapshot(
        scope=_scope(binding_id="binding-A"),
        backend_run_id="run-A",
        snapshot=_snapshot(),
        runtime_layer_specs=_specs(),
    )
    store.save_active_snapshot(
        scope=_scope(binding_id="binding-B"),
        backend_run_id="run-B",
        snapshot=_snapshot(messages=2),
        runtime_layer_specs=_specs(),
    )

    listed = store.list_active_sessions(workflow_run_id="wfr-1")
    assert {s.backend_run_id for s in listed} == {"run-A", "run-B"}
    by_run = {s.backend_run_id: s for s in listed}
    assert isinstance(by_run["run-A"], StoredWorkflowAgentSession)
    # Specs round-trip through pydantic TypeAdapter — ensure deserialize works.
    assert by_run["run-A"].runtime_layer_specs[0].name == "workflow_node_job_prompt"
    assert by_run["run-A"].runtime_layer_specs[1].type == "pydantic_ai.history"
    # node_execution_id default-replaces NULL with "" when the DB column is None.
    assert by_run["run-A"].scope.node_execution_id == "node-exec-1"


def test_list_active_sessions_skips_cleaned_rows():
    store = WorkflowAgentRuntimeSessionStore()
    store.save_active_snapshot(
        scope=_scope(binding_id="binding-A"),
        backend_run_id="run-A",
        snapshot=_snapshot(),
        runtime_layer_specs=_specs(),
    )
    store.save_active_snapshot(
        scope=_scope(binding_id="binding-B"),
        backend_run_id="run-B",
        snapshot=_snapshot(),
        runtime_layer_specs=_specs(),
    )
    store.mark_cleaned(scope=_scope(binding_id="binding-A"), backend_run_id="cleanup-A")

    listed = store.list_active_sessions(workflow_run_id="wfr-1")
    assert {s.backend_run_id for s in listed} == {"run-B"}


def test_list_active_sessions_handles_legacy_rows_without_specs():
    """Rows persisted before runtime_layer_specs landed have an empty string."""
    # Insert a legacy-shape row directly: empty specs payload simulates a row
    # written before the spec persistence feature landed in A.1.
    store = WorkflowAgentRuntimeSessionStore()
    store.save_active_snapshot(
        scope=_scope(),
        backend_run_id="run-legacy",
        snapshot=_snapshot(),
        runtime_layer_specs=[],
    )
    listed = store.list_active_sessions(workflow_run_id="wfr-1")
    assert len(listed) == 1
    assert listed[0].runtime_layer_specs == []


def test_mark_cleaned_sets_status_and_cleaned_at_with_backend_run_id():
    store = WorkflowAgentRuntimeSessionStore()
    store.save_active_snapshot(
        scope=_scope(),
        backend_run_id="run-1",
        snapshot=_snapshot(),
        runtime_layer_specs=_specs(),
    )
    store.mark_cleaned(scope=_scope(), backend_run_id="cleanup-1")

    with session_factory.create_session() as session:
        row = session.query(WorkflowAgentRuntimeSession).one()
        assert row.status == WorkflowAgentRuntimeSessionStatus.CLEANED
        assert row.cleaned_at is not None
        assert row.backend_run_id == "cleanup-1"


def test_mark_cleaned_preserves_existing_backend_run_id_when_none_given():
    """``backend_run_id=None`` means "leave the previous one in place"."""
    store = WorkflowAgentRuntimeSessionStore()
    store.save_active_snapshot(
        scope=_scope(),
        backend_run_id="run-1",
        snapshot=_snapshot(),
        runtime_layer_specs=_specs(),
    )
    store.mark_cleaned(scope=_scope(), backend_run_id=None)

    with session_factory.create_session() as session:
        row = session.query(WorkflowAgentRuntimeSession).one()
        assert row.status == WorkflowAgentRuntimeSessionStatus.CLEANED
        assert row.backend_run_id == "run-1"


def test_mark_cleaned_is_a_noop_when_no_active_row():
    """No matching ACTIVE row → no-op (already-cleaned rows are not re-touched)."""
    store = WorkflowAgentRuntimeSessionStore()
    store.mark_cleaned(scope=_scope(), backend_run_id="cleanup-1")
    with session_factory.create_session() as session:
        assert session.query(WorkflowAgentRuntimeSession).count() == 0


def test_mark_cleaned_is_a_noop_when_workflow_run_id_missing():
    """Without a workflow_run_id we cannot key the row; ignore the call."""
    store = WorkflowAgentRuntimeSessionStore()
    store.mark_cleaned(scope=_scope(workflow_run_id=None), backend_run_id="cleanup-1")
    # Sanity — no rows created or touched.
    with session_factory.create_session() as session:
        assert session.query(WorkflowAgentRuntimeSession).count() == 0
