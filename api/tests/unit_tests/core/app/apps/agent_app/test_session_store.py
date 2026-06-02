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
from sqlalchemy import delete

from core.app.apps.agent_app.session_store import AgentAppRuntimeSessionStore, AgentAppSessionScope
from core.db.session_factory import session_factory
from models.agent import AgentRuntimeSession, AgentRuntimeSessionOwnerType, AgentRuntimeSessionStatus


def _scope(
    conversation_id: str = "conv-1", agent_id: str = "agent-1", agent_config_snapshot_id: str = "snap-1"
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


def test_save_creates_conversation_owned_row_and_round_trips():
    store = AgentAppRuntimeSessionStore()
    store.save_active_snapshot(scope=_scope(), backend_run_id="run-1", snapshot=_snapshot(messages=2))

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


def test_save_is_noop_when_snapshot_missing():
    store = AgentAppRuntimeSessionStore()
    store.save_active_snapshot(scope=_scope(), backend_run_id="run-x", snapshot=None)
    with session_factory.create_session() as session:
        assert session.query(AgentRuntimeSession).count() == 0


def test_second_turn_updates_same_conversation_row():
    store = AgentAppRuntimeSessionStore()
    store.save_active_snapshot(scope=_scope(), backend_run_id="run-1", snapshot=_snapshot(messages=1))
    store.save_active_snapshot(scope=_scope(), backend_run_id="run-2", snapshot=_snapshot(messages=3))
    with session_factory.create_session() as session:
        rows = session.query(AgentRuntimeSession).all()
        assert len(rows) == 1
        assert rows[0].backend_run_id == "run-2"


def test_mark_cleaned_then_load_returns_none_and_save_resurrects():
    store = AgentAppRuntimeSessionStore()
    store.save_active_snapshot(scope=_scope(), backend_run_id="run-1", snapshot=_snapshot())
    store.mark_cleaned(scope=_scope(), backend_run_id="cleanup-1")
    assert store.load_active_snapshot(_scope()) is None
    # Re-entry revives the row.
    store.save_active_snapshot(scope=_scope(), backend_run_id="run-2", snapshot=_snapshot(messages=2))
    with session_factory.create_session() as session:
        row = session.query(AgentRuntimeSession).one()
        assert row.status == AgentRuntimeSessionStatus.ACTIVE
        assert row.cleaned_at is None
        assert row.backend_run_id == "run-2"


def test_distinct_conversations_do_not_collide():
    store = AgentAppRuntimeSessionStore()
    store.save_active_snapshot(scope=_scope(conversation_id="conv-A"), backend_run_id="a", snapshot=_snapshot())
    store.save_active_snapshot(scope=_scope(conversation_id="conv-B"), backend_run_id="b", snapshot=_snapshot())
    assert store.load_active_snapshot(_scope(conversation_id="conv-A")) is not None
    assert store.load_active_snapshot(_scope(conversation_id="conv-B")) is not None
    with session_factory.create_session() as session:
        assert session.query(AgentRuntimeSession).count() == 2


def test_distinct_agent_config_snapshots_do_not_reuse_prior_session():
    store = AgentAppRuntimeSessionStore()
    store.save_active_snapshot(
        scope=_scope(agent_config_snapshot_id="snap-1"),
        backend_run_id="a",
        snapshot=_snapshot(),
    )
    store.save_active_snapshot(
        scope=_scope(agent_config_snapshot_id="snap-2"), backend_run_id="b", snapshot=_snapshot(messages=2)
    )

    assert store.load_active_snapshot(_scope(agent_config_snapshot_id="snap-1")) is not None
    assert store.load_active_snapshot(_scope(agent_config_snapshot_id="snap-2")) is not None
    with session_factory.create_session() as session:
        rows = session.query(AgentRuntimeSession).order_by(AgentRuntimeSession.backend_run_id).all()
        assert len(rows) == 2
        assert [row.agent_config_snapshot_id for row in rows] == ["snap-1", "snap-2"]
