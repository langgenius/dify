"""Tests for the interrupted-session reconciler beat sweeper (Task 5).

The reconciler is a backstop/notifier, not the mechanism that sets
``interrupted`` -- that is already derived on read (Task 3's
``get_session_view``: ``is_working(state) and not session_lock.exists(sid)``).
This task finds sessions stuck in a working state with no live advance lock
past ``WORKFLOW_COPILOT_MAX_ADVANCE_SECONDS`` of staleness, publishes an
``interrupted`` signal to the progress bus for any live SSE to re-sync, and
logs. It must NOT mutate committed session state and must NOT re-enqueue.

Uses the same SQLite-backed ``SqlCopilotRepository`` seed pattern as
``test_engine_on_sql_repo.py``/``test_advance_task.py``, with the task
module's outbound seams (``_session_factory``, ``naive_utc_now``,
``session_lock.exists``, ``progress_bus.publish``) monkeypatched.
"""

from collections.abc import Iterator
from datetime import timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

import schedule.workflow_copilot_reconcile_task as mod
from configs import dify_config
from core.workflow_copilot.models import ConversationItem, EntryMode, FixContext, Session
from core.workflow_copilot.state import PcState
from libs.datetime_utils import naive_utc_now
from models.base import Base
from services.workflow_copilot.repository import SqlCopilotRepository

TENANT_ID = "11111111-1111-1111-1111-111111111111"
APP_ID = "22222222-2222-2222-2222-222222222222"
ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"


@pytest.fixture
def engine() -> Iterator[Engine]:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def factory(engine: Engine) -> sessionmaker:
    return sessionmaker(bind=engine, expire_on_commit=False)


@pytest.fixture
def repo(factory: sessionmaker) -> SqlCopilotRepository:
    return SqlCopilotRepository(factory)


def _seed(repo: SqlCopilotRepository, state: PcState) -> Session:
    s = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.FIX,
        current_state=state,
    )
    repo.create_session(s, FixContext(), [ConversationItem(kind="run-context", seq=0)])
    return s


def test_reconcile_flags_stale_working_session_with_no_live_lock(
    monkeypatch, repo: SqlCopilotRepository, factory: sessionmaker
) -> None:
    a = _seed(repo, PcState.FIX_VERIFY)  # working, no lock -> flagged
    b = _seed(repo, PcState.FIX_VERIFY)  # working, live lock -> skipped
    c = _seed(repo, PcState.FIX_AWAIT_VERIFY)  # waiting -> never considered

    real_now = naive_utc_now()
    monkeypatch.setattr(mod, "_session_factory", lambda: factory)
    monkeypatch.setattr(
        mod,
        "naive_utc_now",
        lambda: real_now + timedelta(seconds=2 * dify_config.WORKFLOW_COPILOT_MAX_ADVANCE_SECONDS),
    )
    monkeypatch.setattr(mod.session_lock, "exists", lambda sid: sid == b.id)

    published: list[tuple[str, dict]] = []
    monkeypatch.setattr(mod.progress_bus, "publish", lambda sid, ev: published.append((sid, ev)))

    count = mod.reconcile_interrupted_sessions()

    assert count == 1
    assert published == [(a.id, {"kind": "error", "error": "interrupted"})]
    assert c.id  # sanity: C was seeded (and never touched)


def test_reconcile_empty_sweep_when_nothing_stale(
    monkeypatch, repo: SqlCopilotRepository, factory: sessionmaker
) -> None:
    _seed(repo, PcState.FIX_VERIFY)  # working, freshly seeded -> not stale

    monkeypatch.setattr(mod, "_session_factory", lambda: factory)
    monkeypatch.setattr(mod.session_lock, "exists", lambda _sid: False)

    published: list[tuple[str, dict]] = []
    monkeypatch.setattr(mod.progress_bus, "publish", lambda sid, ev: published.append((sid, ev)))

    count = mod.reconcile_interrupted_sessions()

    assert count == 0
    assert published == []
