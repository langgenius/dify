"""Tests for the Celery ``advance_session`` task (Task 4).

Runs the real ``Runner``/``fix_registry()`` engine against a SQLite-backed
``SqlCopilotRepository`` -- mirrors the seed pattern from
``test_engine_on_sql_repo.py`` -- but calls the task function directly
(no Celery worker/broker involved) with the module's outbound seams
(``_build_repo``, ``WorkflowServiceDifyPort``, ``progress_bus.publish``,
``session_lock.release``) monkeypatched. Proves the task wires the engine
correctly end to end: it advances the persisted session, publishes node +
terminal ``state`` progress events, and always releases the advance lock --
even when the engine raises (``ConflictError`` -> a generic ``conflict``
error event; any other exception -> a generic ``step failed`` event with no
exception detail leaked).
"""

from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

import tasks.workflow_copilot_advance_task as mod
from core.workflow_copilot.models import ConversationItem, EntryMode, FixContext, Run, Session
from core.workflow_copilot.state import PcState
from models.base import Base
from services.workflow_copilot.repository import SqlCopilotRepository
from tests.unit_tests.core.workflow_copilot.fakes import FakeDifyPort

TENANT_ID = "11111111-1111-1111-1111-111111111111"
APP_ID = "22222222-2222-2222-2222-222222222222"
ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"

_ACTOR_DICT = {"account_id": ACCOUNT_ID, "tenant_id": TENANT_ID}


def _act(kind: str, base_version: int, **payload) -> dict:
    return {"kind": kind, "payload": payload, "base_version": base_version}


def _new_engine_and_repo() -> tuple[Engine, SqlCopilotRepository]:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    return engine, SqlCopilotRepository(factory)


def _seed_fix_session(repo: SqlCopilotRepository) -> Session:
    s = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.FIX,
        current_state=PcState.FIX_DIAGNOSE,
    )
    repo.create_session(
        s,
        FixContext(failed_run_id="TR-1"),
        [ConversationItem(kind="run-context", seq=0)],
    )
    repo.save_run(s.id, Run(id="TR-1", kind="original-failed", status="failed", immutable=True))
    return s


@pytest.fixture
def engine() -> Iterator[Engine]:
    engine, _repo = _new_engine_and_repo()
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def repo(engine: Engine) -> SqlCopilotRepository:
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    return SqlCopilotRepository(factory)


@pytest.fixture
def wired(monkeypatch, repo: SqlCopilotRepository):
    """Patch the task's outbound seams: the SQLite repo, ``FakeDifyPort`` in
    place of the real Dify adapter, and event-capturing stand-ins for
    ``progress_bus.publish``/``session_lock.release``."""
    monkeypatch.setattr(mod, "_build_repo", lambda: repo)
    monkeypatch.setattr(mod, "WorkflowServiceDifyPort", FakeDifyPort)

    events: list[tuple[str, dict]] = []
    released: list[tuple[str, str]] = []
    monkeypatch.setattr(mod.progress_bus, "publish", lambda sid, ev: events.append((sid, ev)))
    monkeypatch.setattr(mod.session_lock, "release", lambda sid, tok: released.append((sid, tok)))
    return events, released


def test_advance_session_drives_state_forward_emits_events_and_releases_lock(repo: SqlCopilotRepository, wired) -> None:
    events, released = wired
    s = _seed_fix_session(repo)

    # 1) request_fix -> auto-advances to fix.await_verify; the terminal state
    #    event must be published and the lock released.
    mod.advance_session(s.id, _act("request_fix", 1), _ACTOR_DICT, "tok-1")

    stored, _fc = repo.get_session(s.id)
    assert stored.current_state == PcState.FIX_AWAIT_VERIFY

    state_events = [ev for _sid, ev in events if ev["kind"] == "state"]
    assert state_events, "advance_session must publish a terminal state event"
    last_state_event = state_events[-1]
    assert last_state_event["state"] == "fix.await_verify"
    assert last_state_event["canvas_read_only"] is False
    # Task 4: the state frame widens to spec §3's full shape -- projected
    # from a SessionView, so phase/run_status/actions come along for free.
    assert last_state_event["phase"] == "test"
    assert last_state_event["run_status"] == "waiting_input"
    # Task 5a: actions are now data-driven per PcState; fix.await_verify's
    # table entries are run_validation (primary) + revert (destructive).
    assert [a["id"] for a in last_state_event["actions"]] == ["run_validation", "revert"]

    canvas_events = [ev for _sid, ev in events if ev["kind"] == "canvas"]
    assert canvas_events, "advance_session must publish canvas events once the adapter emits them"
    assert canvas_events[0]["event"] == "apply_error_fix"

    assert released == [(s.id, "tok-1")]

    # 2) continue driving: run_verify -> fix.await_testdata -> provide_testdata
    #    (mock) -> fix.verify (working, emits node events) -> fix.await_decision.
    stored, _fc = repo.get_session(s.id)
    mod.advance_session(s.id, _act("run_verify", stored.version), _ACTOR_DICT, "tok-2")

    stored, _fc = repo.get_session(s.id)
    mod.advance_session(s.id, _act("provide_testdata", stored.version, mode="mock"), _ACTOR_DICT, "tok-3")

    stored, _fc = repo.get_session(s.id)
    assert stored.current_state == PcState.FIX_AWAIT_DECISION

    node_events = [ev for _sid, ev in events if ev["kind"] == "node"]
    assert node_events, "FakeDifyPort.run_draft's on_event callback must reach progress_bus as node events"

    assert (s.id, "tok-2") in released
    assert (s.id, "tok-3") in released


def test_advance_session_conflict_error_publishes_conflict_and_releases_lock(repo: SqlCopilotRepository, wired) -> None:
    events, released = wired
    s = _seed_fix_session(repo)

    before, _fc = repo.get_session(s.id)

    # base_version=999 never matches the session's real current version (1),
    # so the runner raises ConflictError before touching anything.
    mod.advance_session(s.id, _act("run_verify", 999), _ACTOR_DICT, "tok-x")

    error_events = [ev for _sid, ev in events if ev["kind"] == "error"]
    assert {"kind": "error", "error": "conflict"} in [{**ev} for ev in error_events]

    after, _fc = repo.get_session(s.id)
    assert after.current_state == before.current_state
    assert after.version == before.version

    assert (s.id, "tok-x") in released


def test_advance_session_generic_exception_publishes_generic_error_and_releases_lock(monkeypatch) -> None:
    # A fresh, isolated engine/repo/session so the FakeDifyPort.read_graph
    # monkeypatch below cannot bleed into any other test.
    engine, repo = _new_engine_and_repo()
    try:
        monkeypatch.setattr(mod, "_build_repo", lambda: repo)
        monkeypatch.setattr(mod, "WorkflowServiceDifyPort", FakeDifyPort)

        def _raise(_self, _app_id, _actor):
            raise RuntimeError("boom: some secret internal detail")

        monkeypatch.setattr(FakeDifyPort, "read_graph", _raise)

        events: list[tuple[str, dict]] = []
        released: list[tuple[str, str]] = []
        monkeypatch.setattr(mod.progress_bus, "publish", lambda sid, ev: events.append((sid, ev)))
        monkeypatch.setattr(mod.session_lock, "release", lambda sid, tok: released.append((sid, tok)))

        s = _seed_fix_session(repo)

        mod.advance_session(s.id, _act("request_fix", 1), _ACTOR_DICT, "tok-y")

        assert next((ev["kind"], ev["error"]) for _sid, ev in events if ev["kind"] == "error") == (
            "error",
            "step failed",
        )
        # no exception detail must leak into the published event.
        assert all("boom" not in str(ev) for _sid, ev in events)

        assert (s.id, "tok-y") in released
    finally:
        engine.dispose()


def test_advance_session_setup_failure_still_releases_lock(monkeypatch) -> None:
    """A failure while constructing the task's dependencies (before the engine
    ever runs) must still fall into the generic ``except`` and release the
    lock in ``finally`` -- otherwise the lock leaks until its TTL and the
    session is stuck ``busy`` for up to ``MAX_ADVANCE``."""

    def _boom():
        raise RuntimeError("db down")

    monkeypatch.setattr(mod, "_build_repo", _boom)

    events: list[tuple[str, dict]] = []
    released: list[tuple[str, str]] = []
    monkeypatch.setattr(mod.progress_bus, "publish", lambda sid, ev: events.append((sid, ev)))
    monkeypatch.setattr(mod.session_lock, "release", lambda sid, tok: released.append((sid, tok)))

    mod.advance_session("sess-setup", _act("request_fix", 1), _ACTOR_DICT, "tok-setup")

    assert next((ev["kind"], ev["error"]) for _sid, ev in events if ev["kind"] == "error") == (
        "error",
        "step failed",
    )
    # no exception detail must leak into the published event.
    assert all("db down" not in str(ev) for _sid, ev in events)

    assert ("sess-setup", "tok-setup") in released
