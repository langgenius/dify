"""P3b acceptance: the usecase, the Celery task, and the SQL repo wired
together end to end (Task 6).

Runs the real ``WorkflowCopilotService`` (Task 3) with an *eager*
``enqueue_fn`` that calls the real ``advance_session`` Celery task (Task 4)
synchronously -- no broker/worker involved -- over a SQLite-backed
``SqlCopilotRepository`` shared by both sides (the task's ``_build_repo`` is
monkeypatched to return the very same repo instance the usecase holds) and
the real ``services.workflow_copilot.session_lock`` module shared by both
sides too (only its ``redis_client`` is faked, once, so the usecase's
``acquire`` and the task's ``release`` observe the same lock state).

Proves the full P3b integration: dispatch acquires the lock and enqueues,
the task synchronously drives the engine, emits progress events, persists
through the shared repo, and releases the lock -- all inside one
``submit_action``/``create_fix_session`` call, with cross-process busy
serialization (a second submit while the lock is held) verified separately.

Test-only: no production code changes belong in this file.
"""

import dataclasses
from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

import tasks.workflow_copilot_advance_task as task_mod
from core.workflow_copilot.errors import BusyError
from core.workflow_copilot.models import Action, Actor, ConversationItem, EntryMode, FixContext, Run, Session
from core.workflow_copilot.state import PcState
from models.base import Base
from services.workflow_copilot import session_lock
from services.workflow_copilot.repository import SqlCopilotRepository
from services.workflow_copilot.service import WorkflowCopilotService
from tests.unit_tests.core.workflow_copilot.fakes import FakeDifyPort

TENANT_ID = "11111111-1111-1111-1111-111111111111"
APP_ID = "22222222-2222-2222-2222-222222222222"
ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"


class _FakeRedis:
    """In-memory model of the two ops session_lock uses: SET NX PX and the
    Lua compare-del via eval."""

    def __init__(self) -> None:
        self._store: dict = {}

    def set(self, name, value, nx=False, px=None, **kw):  # noqa: ARG002
        if nx and name in self._store:
            return None
        self._store[name] = value
        return True

    def get(self, name):
        return self._store.get(name)

    def eval(self, script, numkeys, *args):  # noqa: ARG002
        key, token = args[0], args[1]
        if self._store.get(key) == token:
            del self._store[key]
            return 1
        return 0


def _actor() -> Actor:
    return Actor(account_id=ACCOUNT_ID, tenant_id=TENANT_ID)


@pytest.fixture
def engine() -> Iterator[Engine]:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def repo(engine: Engine) -> SqlCopilotRepository:
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    return SqlCopilotRepository(factory)


def _wire(monkeypatch, repo: SqlCopilotRepository) -> tuple[WorkflowCopilotService, list[tuple[str, dict]]]:
    """Wire the usecase to the real task, run eagerly, over the shared repo
    and the real (faked-Redis) session_lock module."""
    monkeypatch.setattr(session_lock, "redis_client", _FakeRedis())  # real lock module, faked redis (shared)
    monkeypatch.setattr(task_mod, "_build_repo", lambda: repo)  # task uses the SAME repo
    monkeypatch.setattr(task_mod, "WorkflowServiceDifyPort", FakeDifyPort)

    events: list[tuple[str, dict]] = []
    monkeypatch.setattr(task_mod.progress_bus, "publish", lambda sid, ev: events.append((sid, ev)))

    def eager_enqueue(session_id, action, actor, token) -> None:
        task_mod.advance_session(session_id, dataclasses.asdict(action), dataclasses.asdict(actor), token)

    svc = WorkflowCopilotService(repo, session_lock, eager_enqueue)
    return svc, events


# ---- Test 1: full happy path, async-wired -----------------------------------


def test_full_fix_flow_create_to_publish_success_eager_async(
    monkeypatch, repo: SqlCopilotRepository
) -> None:
    # Seed the failed run BEFORE creating the session -- get_run is by id
    # with no FK, so any placeholder session_id works here.
    repo.save_run(
        "00000000-0000-0000-0000-000000000000",
        Run(id="TR-1", kind="original-failed", dify_run_id="", status="failed", immutable=True),
    )

    svc, events = _wire(monkeypatch, repo)

    # create_fix_session's dispatch runs the task synchronously (eager
    # enqueue), so the returned view already reflects the advanced state:
    # fix.diagnose -> fix.propose -> fix.apply -> fix.await_verify.
    view = svc.create_fix_session(APP_ID, _actor(), failed_run_id="TR-1")
    assert view.state == "fix.await_verify"
    assert session_lock.exists(view.session_id) is False, "the task must release the lock in its finally"

    sid = view.session_id

    view = svc.submit_action(sid, _actor(), Action(kind="run_verify", base_version=view.version))
    assert view.state == "fix.await_testdata"
    assert session_lock.exists(sid) is False

    view = svc.submit_action(
        sid, _actor(), Action(kind="provide_testdata", payload={"mode": "mock"}, base_version=view.version)
    )
    assert view.state == "fix.await_decision"
    assert session_lock.exists(sid) is False

    view = svc.submit_action(sid, _actor(), Action(kind="publish", base_version=view.version))
    assert view.state == "success"

    stored, _fc = repo.get_session(sid)
    assert stored.current_state == PcState.SUCCESS

    # the bus received both node events (from the provide_testdata -> fix.verify
    # draft run) and terminal state events across the whole flow.
    assert any(ev.get("kind") == "node" for _sid, ev in events)
    assert any(ev.get("kind") == "state" for _sid, ev in events)

    # the lock was acquired-then-released on every dispatch, including the
    # final one.
    assert session_lock.exists(sid) is False


# ---- Test 2: busy while a lock is held --------------------------------------


def test_submit_action_while_lock_held_raises_busy_eager_async(
    monkeypatch, repo: SqlCopilotRepository
) -> None:
    svc, _events = _wire(monkeypatch, repo)

    # Seed the session DIRECTLY via the repo (bypassing create_fix_session,
    # whose eager dispatch would immediately release the lock again).
    s = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.FIX,
        current_state=PcState.FIX_DIAGNOSE,
    )
    repo.create_session(s, FixContext(failed_run_id="TR-1"), [ConversationItem(kind="run-context", seq=0)])

    # Manually hold the lock, simulating an in-flight advance on another
    # worker.
    held = session_lock.acquire(s.id)
    assert held is not None

    # CAS passes (version is 1), but dispatch's acquire fails because the
    # lock is still held -- proving the cross-process serialization.
    with pytest.raises(BusyError):
        svc.submit_action(s.id, _actor(), Action(kind="request_fix", base_version=1))

    stored, _fc = repo.get_session(s.id)
    assert stored.current_state == PcState.FIX_DIAGNOSE, "a busy dispatch must leave the session untouched"

    session_lock.release(s.id, held)
    reacquired = session_lock.acquire(s.id)
    assert reacquired is not None, "release must actually free the lock"
