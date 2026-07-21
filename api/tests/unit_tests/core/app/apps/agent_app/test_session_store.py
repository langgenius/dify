"""Unit tests for the conversation-keyed Agent App session store.

Exercises the real ORM round-trip against the project's in-memory SQLite engine
(per-test create/drop of the unified ``agent_runtime_sessions`` table), so the
conversation owner path is verified without Postgres.
"""

from __future__ import annotations

from collections.abc import Generator

import pytest
from agenton.compositor import CompositorSessionSnapshot
from agenton.compositor.schemas import LayerSessionSnapshot
from agenton.layers.base import LifecycleState
from dify_agent.protocol import RuntimeLayerSpec
from sqlalchemy import delete

from core.app.apps.agent_app.session_store import (
    AgentAppRuntimeSessionStore,
    AgentAppSessionScope,
    StoredAgentAppSession,
)
from core.db.session_factory import session_factory
from models.agent import AgentRuntimeSession, AgentRuntimeSessionOwnerType, AgentRuntimeSessionStatus


def _scope(
    conversation_id: str = "conv-1", agent_id: str = "agent-1", agent_config_snapshot_id: str | None = "snap-1"
) -> AgentAppSessionScope:
    return AgentAppSessionScope(
        tenant_id="tenant-1",
        app_id="app-1",
        conversation_id=conversation_id,
        agent_id=agent_id,
        agent_config_snapshot_id=agent_config_snapshot_id,
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


def _sandbox_snapshot(handle: str) -> CompositorSessionSnapshot:
    return CompositorSessionSnapshot(
        layers=[
            LayerSessionSnapshot(
                name="sandbox",
                lifecycle_state=LifecycleState.SUSPENDED,
                runtime_state={"handle": handle},
            )
        ]
    )


def _runtime_layer_specs() -> list[RuntimeLayerSpec]:
    return [
        RuntimeLayerSpec(name="execution_context", type="dify.execution_context", config={"tenant_id": "tenant-1"}),
        RuntimeLayerSpec(name="history", type="pydantic_ai.history"),
    ]


def _save_active_snapshot(
    store: AgentAppRuntimeSessionStore,
    *,
    scope: AgentAppSessionScope,
    backend_run_id: str,
    snapshot: CompositorSessionSnapshot | None,
    runtime_layer_specs: list[RuntimeLayerSpec],
    runtime_session_id: str | None = None,
) -> None:
    resolved_runtime_session_id = (
        runtime_session_id if runtime_session_id is not None else store.resolve_runtime_session_id(scope)
    )
    store.save_active_snapshot(
        scope=scope,
        runtime_session_id=resolved_runtime_session_id,
        backend_run_id=backend_run_id,
        snapshot=snapshot,
        runtime_layer_specs=runtime_layer_specs,
    )


@pytest.fixture(autouse=True)
def _create_table() -> Generator[None, None, None]:
    engine = session_factory.get_session_maker().kw["bind"]
    AgentRuntimeSession.__table__.create(bind=engine, checkfirst=True)
    yield
    with session_factory.create_session() as session:
        session.execute(delete(AgentRuntimeSession))
        session.commit()
    AgentRuntimeSession.__table__.drop(bind=engine, checkfirst=True)


def test_load_returns_none_when_no_row():
    assert AgentAppRuntimeSessionStore().load_active_snapshot(_scope()) is None


def test_stored_session_rejects_empty_runtime_session_id() -> None:
    with pytest.raises(ValueError, match="runtime_session_id"):
        StoredAgentAppSession(
            scope=_scope(),
            runtime_session_id="",
            session_snapshot=_snapshot(),
            backend_run_id="run-1",
        )


def test_save_rejects_empty_runtime_session_id() -> None:
    with pytest.raises(ValueError, match="runtime_session_id"):
        AgentAppRuntimeSessionStore().save_active_snapshot(
            scope=_scope(),
            runtime_session_id="",
            backend_run_id="run-1",
            snapshot=_snapshot(),
            runtime_layer_specs=_runtime_layer_specs(),
        )


def test_save_creates_conversation_owned_row_and_round_trips():
    store = AgentAppRuntimeSessionStore()
    _save_active_snapshot(
        store,
        scope=_scope(),
        backend_run_id="run-1",
        snapshot=_snapshot(messages=2),
        runtime_layer_specs=_runtime_layer_specs(),
    )

    loaded = store.load_active_snapshot(_scope())
    assert loaded is not None
    assert loaded.layers[0].runtime_state["messages"] == [
        {"role": "user", "content": "m0"},
        {"role": "user", "content": "m1"},
    ]
    with session_factory.create_session() as session:
        row = session.query(AgentRuntimeSession).one()
        assert row.owner_type == AgentRuntimeSessionOwnerType.CONVERSATION
        assert row.conversation_id == "conv-1"
        assert row.agent_config_snapshot_id == "snap-1"
        assert row.workflow_run_id is None  # conversation owner leaves workflow cols NULL
        assert row.backend_run_id == "run-1"
        assert "execution_context" in row.composition_layer_specs
        assert "history" in row.composition_layer_specs


def test_save_is_noop_when_snapshot_missing():
    store = AgentAppRuntimeSessionStore()
    _save_active_snapshot(
        store,
        scope=_scope(),
        backend_run_id="run-x",
        snapshot=None,
        runtime_layer_specs=_runtime_layer_specs(),
    )
    with session_factory.create_session() as session:
        assert session.query(AgentRuntimeSession).count() == 0


def test_second_turn_updates_same_conversation_row():
    store = AgentAppRuntimeSessionStore()
    _save_active_snapshot(
        store,
        scope=_scope(),
        backend_run_id="run-1",
        snapshot=_snapshot(messages=1),
        runtime_layer_specs=_runtime_layer_specs(),
    )
    _save_active_snapshot(
        store,
        scope=_scope(),
        backend_run_id="run-2",
        snapshot=_snapshot(messages=3),
        runtime_layer_specs=_runtime_layer_specs(),
    )
    with session_factory.create_session() as session:
        rows = session.query(AgentRuntimeSession).all()
        assert len(rows) == 1
        assert rows[0].backend_run_id == "run-2"


def test_debug_scope_with_null_snapshot_id_updates_same_conversation_row():
    store = AgentAppRuntimeSessionStore()
    scope = _scope(agent_config_snapshot_id=None)
    _save_active_snapshot(
        store,
        scope=scope,
        backend_run_id="run-1",
        snapshot=_snapshot(messages=1),
        runtime_layer_specs=_runtime_layer_specs(),
    )
    _save_active_snapshot(
        store,
        scope=scope,
        backend_run_id="run-2",
        snapshot=_snapshot(messages=3),
        runtime_layer_specs=_runtime_layer_specs(),
    )

    loaded = store.load_active_snapshot(scope)

    assert loaded is not None
    assert loaded.layers[0].runtime_state["messages"] == [
        {"role": "user", "content": "m0"},
        {"role": "user", "content": "m1"},
        {"role": "user", "content": "m2"},
    ]
    with session_factory.create_session() as session:
        row = session.query(AgentRuntimeSession).one()
        assert row.agent_config_snapshot_id is None
        assert row.backend_run_id == "run-2"


def test_mark_cleaned_then_save_replaces_row_and_preserves_old_cleanup_snapshot():
    store = AgentAppRuntimeSessionStore()
    _save_active_snapshot(
        store,
        scope=_scope(),
        runtime_session_id="runtime-session-old",
        backend_run_id="run-1",
        snapshot=_sandbox_snapshot("runtime-session-old"),
        runtime_layer_specs=_runtime_layer_specs(),
    )
    cleanup_session = store.load_active_session(_scope())
    assert cleanup_session is not None
    store.mark_cleaned(scope=_scope(), backend_run_id="cleanup-1")
    assert store.load_active_snapshot(_scope()) is None
    new_runtime_session_id = store.resolve_runtime_session_id(_scope())
    assert new_runtime_session_id != "runtime-session-old"

    _save_active_snapshot(
        store,
        scope=_scope(),
        runtime_session_id=new_runtime_session_id,
        backend_run_id="run-2",
        snapshot=_sandbox_snapshot(new_runtime_session_id),
        runtime_layer_specs=_runtime_layer_specs(),
    )
    with session_factory.create_session() as session:
        row = session.query(AgentRuntimeSession).one()
        assert row.id == new_runtime_session_id
        assert row.status == AgentRuntimeSessionStatus.ACTIVE
        assert row.cleaned_at is None
        assert row.backend_run_id == "run-2"
    assert cleanup_session.runtime_session_id == "runtime-session-old"
    assert cleanup_session.session_snapshot.layers[0].runtime_state == {"handle": "runtime-session-old"}


def test_resolve_runtime_session_id_does_not_reuse_cleaned_row_identity() -> None:
    store = AgentAppRuntimeSessionStore()
    _save_active_snapshot(
        store,
        scope=_scope(),
        runtime_session_id="runtime-session-1",
        backend_run_id="run-1",
        snapshot=_snapshot(),
        runtime_layer_specs=_runtime_layer_specs(),
    )
    store.mark_cleaned(scope=_scope(), backend_run_id="cleanup-1")

    assert store.resolve_runtime_session_id(_scope()) != "runtime-session-1"


def test_save_rejects_runtime_session_id_that_differs_from_existing_row() -> None:
    store = AgentAppRuntimeSessionStore()
    _save_active_snapshot(
        store,
        scope=_scope(),
        runtime_session_id="runtime-session-1",
        backend_run_id="run-1",
        snapshot=_snapshot(),
        runtime_layer_specs=_runtime_layer_specs(),
    )
    with pytest.raises(ValueError, match="runtime_session_id"):
        _save_active_snapshot(
            store,
            scope=_scope(),
            runtime_session_id="runtime-session-2",
            backend_run_id="run-2",
            snapshot=_snapshot(messages=2),
            runtime_layer_specs=_runtime_layer_specs(),
        )

    with session_factory.create_session() as session:
        row = session.query(AgentRuntimeSession).one()
        assert row.id == "runtime-session-1"
        assert row.status == AgentRuntimeSessionStatus.ACTIVE


def test_save_rejects_reusing_cleaned_runtime_session_id() -> None:
    store = AgentAppRuntimeSessionStore()
    _save_active_snapshot(
        store,
        scope=_scope(),
        runtime_session_id="runtime-session-1",
        backend_run_id="run-1",
        snapshot=_snapshot(),
        runtime_layer_specs=_runtime_layer_specs(),
    )
    store.mark_cleaned(scope=_scope(), backend_run_id="cleanup-1")

    with pytest.raises(ValueError, match="CLEANED"):
        _save_active_snapshot(
            store,
            scope=_scope(),
            runtime_session_id="runtime-session-1",
            backend_run_id="run-2",
            snapshot=_snapshot(messages=2),
            runtime_layer_specs=_runtime_layer_specs(),
        )


def test_distinct_conversations_do_not_collide():
    store = AgentAppRuntimeSessionStore()
    _save_active_snapshot(
        store,
        scope=_scope(conversation_id="conv-A"),
        backend_run_id="a",
        snapshot=_snapshot(),
        runtime_layer_specs=_runtime_layer_specs(),
    )
    _save_active_snapshot(
        store,
        scope=_scope(conversation_id="conv-B"),
        backend_run_id="b",
        snapshot=_snapshot(),
        runtime_layer_specs=_runtime_layer_specs(),
    )
    assert store.load_active_snapshot(_scope(conversation_id="conv-A")) is not None
    assert store.load_active_snapshot(_scope(conversation_id="conv-B")) is not None
    with session_factory.create_session() as session:
        assert session.query(AgentRuntimeSession).count() == 2


def test_distinct_agent_config_snapshots_keep_only_latest_active_session():
    store = AgentAppRuntimeSessionStore()
    _save_active_snapshot(
        store,
        scope=_scope(agent_config_snapshot_id="snap-1"),
        backend_run_id="a",
        snapshot=_snapshot(),
        runtime_layer_specs=_runtime_layer_specs(),
    )
    _save_active_snapshot(
        store,
        scope=_scope(agent_config_snapshot_id="snap-2"),
        backend_run_id="b",
        snapshot=_snapshot(messages=2),
        runtime_layer_specs=_runtime_layer_specs(),
    )

    assert store.load_active_snapshot(_scope(agent_config_snapshot_id="snap-1")) is None
    assert store.load_active_snapshot(_scope(agent_config_snapshot_id="snap-2")) is not None
    with session_factory.create_session() as session:
        rows = session.query(AgentRuntimeSession).order_by(AgentRuntimeSession.backend_run_id).all()
        assert len(rows) == 2
        assert [row.agent_config_snapshot_id for row in rows] == ["snap-1", "snap-2"]
        assert [row.status for row in rows] == [AgentRuntimeSessionStatus.CLEANED, AgentRuntimeSessionStatus.ACTIVE]


def test_load_active_session_for_conversation_resolves_without_agent_or_config_scope():
    store = AgentAppRuntimeSessionStore()
    _save_active_snapshot(
        store,
        scope=_scope(),
        backend_run_id="run-1",
        snapshot=_snapshot(messages=2),
        runtime_layer_specs=_runtime_layer_specs(),
    )

    loaded = store.load_active_session_for_conversation(tenant_id="tenant-1", app_id="app-1", conversation_id="conv-1")
    assert loaded is not None
    assert loaded.session_snapshot.layers[0].runtime_state["messages"] == [
        {"role": "user", "content": "m0"},
        {"role": "user", "content": "m1"},
    ]
    assert [spec.name for spec in loaded.runtime_layer_specs] == ["execution_context", "history"]


def test_load_active_session_for_conversation_uses_latest_active_snapshot_after_config_change():
    store = AgentAppRuntimeSessionStore()
    _save_active_snapshot(
        store,
        scope=_scope(agent_config_snapshot_id="snap-1"),
        backend_run_id="a",
        snapshot=_snapshot(),
        runtime_layer_specs=_runtime_layer_specs(),
    )
    _save_active_snapshot(
        store,
        scope=_scope(agent_config_snapshot_id="snap-2"),
        backend_run_id="b",
        snapshot=_snapshot(messages=3),
        runtime_layer_specs=_runtime_layer_specs(),
    )

    loaded = store.load_active_session_for_conversation(tenant_id="tenant-1", app_id="app-1", conversation_id="conv-1")

    assert loaded is not None
    assert loaded.session_snapshot.layers[0].runtime_state["messages"] == [
        {"role": "user", "content": "m0"},
        {"role": "user", "content": "m1"},
        {"role": "user", "content": "m2"},
    ]


def test_load_active_session_for_conversation_returns_none_when_cleaned_or_absent():
    store = AgentAppRuntimeSessionStore()
    assert (
        store.load_active_session_for_conversation(tenant_id="tenant-1", app_id="app-1", conversation_id="conv-1")
        is None
    )

    _save_active_snapshot(
        store,
        scope=_scope(),
        backend_run_id="run-1",
        snapshot=_snapshot(),
        runtime_layer_specs=_runtime_layer_specs(),
    )
    store.mark_cleaned(scope=_scope(), backend_run_id="cleanup-1")
    assert (
        store.load_active_session_for_conversation(tenant_id="tenant-1", app_id="app-1", conversation_id="conv-1")
        is None
    )


def test_load_active_session_for_conversation_isolates_other_conversations():
    store = AgentAppRuntimeSessionStore()
    _save_active_snapshot(
        store,
        scope=_scope(conversation_id="conv-A"),
        backend_run_id="a",
        snapshot=_snapshot(),
        runtime_layer_specs=_runtime_layer_specs(),
    )

    assert (
        store.load_active_session_for_conversation(tenant_id="tenant-1", app_id="app-1", conversation_id="conv-B")
        is None
    )
    assert (
        store.load_active_session_for_conversation(tenant_id="tenant-1", app_id="app-1", conversation_id="conv-A")
        is not None
    )


def test_list_active_sessions_for_conversation_returns_all_active_rows():
    store = AgentAppRuntimeSessionStore()
    with session_factory.create_session() as session:
        session.add(
            AgentRuntimeSession(
                tenant_id="tenant-1",
                app_id="app-1",
                owner_type=AgentRuntimeSessionOwnerType.CONVERSATION,
                agent_id="agent-1",
                agent_config_snapshot_id="snap-1",
                conversation_id="conv-1",
                backend_run_id="run-1",
                session_snapshot=_snapshot(messages=1).model_dump_json(),
                composition_layer_specs='[{"name":"execution_context","type":"dify.execution_context","deps":{},"metadata":{},"config":{"tenant_id":"tenant-1"}},{"name":"history","type":"pydantic_ai.history","deps":{},"metadata":{},"config":null}]',
                status=AgentRuntimeSessionStatus.ACTIVE,
            )
        )
        session.add(
            AgentRuntimeSession(
                tenant_id="tenant-1",
                app_id="app-1",
                owner_type=AgentRuntimeSessionOwnerType.CONVERSATION,
                agent_id="agent-2",
                agent_config_snapshot_id="snap-2",
                conversation_id="conv-1",
                backend_run_id="run-2",
                session_snapshot=_snapshot(messages=2).model_dump_json(),
                composition_layer_specs='[{"name":"execution_context","type":"dify.execution_context","deps":{},"metadata":{},"config":{"tenant_id":"tenant-1"}},{"name":"history","type":"pydantic_ai.history","deps":{},"metadata":{},"config":null}]',
                status=AgentRuntimeSessionStatus.ACTIVE,
            )
        )
        session.commit()

    loaded = store.list_active_sessions_for_conversation(
        tenant_id="tenant-1",
        app_id="app-1",
        conversation_id="conv-1",
    )

    assert [session.scope.agent_id for session in loaded] == ["agent-2", "agent-1"]
    assert all(session.scope.conversation_id == "conv-1" for session in loaded)
