"""Tests for the Celery ``advance_session`` task (Task 4).

Runs the real ``Runner``/``fix_registry()`` engine against a SQLite-backed
``SqlDifyBuilderRepository`` -- mirrors the seed pattern from
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

import tasks.dify_builder_advance_task as mod
from core.dify_builder.models import ConversationItem, DifyBuilderContext, EntryMode, Run, Session
from core.dify_builder.state import PcState
from models.base import Base
from services.dify_builder.repository import SqlDifyBuilderRepository
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort

TENANT_ID = "11111111-1111-1111-1111-111111111111"
APP_ID = "22222222-2222-2222-2222-222222222222"
ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"

_ACTOR_DICT = {"account_id": ACCOUNT_ID, "tenant_id": TENANT_ID}


def _act(kind: str, base_version: int, **payload) -> dict:
    return {"kind": kind, "payload": payload, "base_version": base_version}


def _new_engine_and_repo() -> tuple[Engine, SqlDifyBuilderRepository]:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    return engine, SqlDifyBuilderRepository(factory)


def _seed_fix_session(repo: SqlDifyBuilderRepository) -> Session:
    s = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.FIX,
        current_state=PcState.FIX_DIAGNOSE,
    )
    repo.create_session(
        s,
        DifyBuilderContext(failed_run_id="TR-1"),
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
def repo(engine: Engine) -> SqlDifyBuilderRepository:
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    return SqlDifyBuilderRepository(factory)


@pytest.fixture
def wired(monkeypatch, repo: SqlDifyBuilderRepository):
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


def test_advance_session_drives_state_forward_emits_events_and_releases_lock(
    repo: SqlDifyBuilderRepository, wired
) -> None:
    events, released = wired
    s = _seed_fix_session(repo)

    # 1) request_fix -> auto-advances to fix.await_verify; the terminal state
    #    event must be published and the lock released.
    mod.advance_session(s.id, _act("request_fix", 1), _ACTOR_DICT, "tok-1")

    stored, _fc = repo.get_session(s.id)
    assert stored.current_state == PcState.FIX_AWAIT_VERIFY

    state_events = [ev for _sid, ev in events if ev["kind"] == "state"]
    assert len(state_events) == 1, "advance_session must publish exactly one terminal state event"
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

    commit_events = [ev for _sid, ev in events if ev["kind"] == "commit"]
    assert commit_events, "each successful CAS must be observable before the terminal state"
    assert [event["version"] for event in commit_events] == sorted(event["version"] for event in commit_events)
    assert commit_events[-1]["settled"] is True
    assert commit_events[-1]["version"] == last_state_event["version"]
    assert commit_events[-1]["state"] == last_state_event["state"]
    assert events[-1][1]["kind"] == "state"

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


def test_advance_session_conflict_error_publishes_conflict_and_releases_lock(
    repo: SqlDifyBuilderRepository, wired
) -> None:
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


def test_terminal_error_is_published_after_the_advance_lock_is_released(
    monkeypatch: pytest.MonkeyPatch,
    repo: SqlDifyBuilderRepository,
) -> None:
    monkeypatch.setattr(mod, "_build_repo", lambda: repo)
    monkeypatch.setattr(mod, "WorkflowServiceDifyPort", FakeDifyPort)
    timeline: list[str] = []
    monkeypatch.setattr(
        mod.progress_bus,
        "publish",
        lambda _sid, event: timeline.append(f"publish:{event['kind']}"),
    )
    monkeypatch.setattr(
        mod.session_lock,
        "release",
        lambda _sid, _token: timeline.append("release"),
    )
    s = _seed_fix_session(repo)

    mod.advance_session(s.id, _act("run_verify", 999), _ACTOR_DICT, "tok-order")

    assert timeline == ["release", "publish:error"]


def test_terminal_state_is_published_after_the_advance_lock_is_released(
    monkeypatch: pytest.MonkeyPatch,
    repo: SqlDifyBuilderRepository,
) -> None:
    monkeypatch.setattr(mod, "_build_repo", lambda: repo)
    monkeypatch.setattr(mod, "WorkflowServiceDifyPort", FakeDifyPort)
    timeline: list[str] = []
    monkeypatch.setattr(
        mod.progress_bus,
        "publish",
        lambda _sid, event: timeline.append(f"publish:{event['kind']}"),
    )
    monkeypatch.setattr(
        mod.session_lock,
        "release",
        lambda _sid, _token: timeline.append("release"),
    )
    s = _seed_fix_session(repo)

    mod.advance_session(s.id, _act("request_fix", 1), _ACTOR_DICT, "tok-order")

    assert timeline[-2:] == ["release", "publish:state"]


def test_message_advance_publishes_assistant_delta_before_durable_reply(
    repo: SqlDifyBuilderRepository,
    wired,
) -> None:
    events, released = wired
    session = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.FIX,
        current_state=PcState.FIX_AWAIT_APPROVAL,
    )
    repo.create_session(session, DifyBuilderContext(), [])

    mod.advance_session(
        session.id,
        _act("message", 1, text="Can you explain this?", client_turn_id="turn-1"),
        _ACTOR_DICT,
        "tok-message",
    )

    payloads = [event for _session_id, event in events]
    kinds = [event["kind"] for event in payloads]
    assert kinds == ["commit", "agent_message", "commit", "state"]
    assert payloads[0]["items"][0]["kind"] == "user"
    assert payloads[1]["id"] == "turn-1"
    assert payloads[1]["answer"]
    assert payloads[1]["seq"] == 1
    assert payloads[1]["at_version"] == 3
    assert payloads[2]["items"][0]["kind"] == "assistant_turn"
    assert payloads[2]["items"][0]["payload"]["reply_text"] == payloads[1]["answer"]
    assert released == [(session.id, "tok-message")]


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


def test_commit_publish_failure_is_best_effort_and_terminal_state_is_still_published_once(
    monkeypatch: pytest.MonkeyPatch,
    repo: SqlDifyBuilderRepository,
) -> None:
    monkeypatch.setattr(mod, "_build_repo", lambda: repo)
    monkeypatch.setattr(mod, "WorkflowServiceDifyPort", FakeDifyPort)

    events: list[tuple[str, dict]] = []
    released: list[tuple[str, str]] = []

    def publish(session_id: str, event: dict) -> None:
        if event["kind"] == "commit":
            raise RuntimeError("progress bus unavailable")
        events.append((session_id, event))

    monkeypatch.setattr(mod.progress_bus, "publish", publish)
    monkeypatch.setattr(mod.session_lock, "release", lambda sid, tok: released.append((sid, tok)))
    s = _seed_fix_session(repo)

    mod.advance_session(s.id, _act("request_fix", 1), _ACTOR_DICT, "tok-best-effort")

    stored, _fc = repo.get_session(s.id)
    assert stored.current_state == PcState.FIX_AWAIT_VERIFY
    assert [event["kind"] for _sid, event in events].count("state") == 1
    assert all(event["kind"] != "error" for _sid, event in events)
    assert events[-1][1]["kind"] == "state"
    assert released == [(s.id, "tok-best-effort")]


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


def _seed_build_session(repo: SqlDifyBuilderRepository) -> Session:
    s = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_CAPABILITY_CHECK,
    )
    repo.create_session(
        s,
        DifyBuilderContext(goal_text="Build a report workflow"),
        [ConversationItem(kind="user", seq=0)],
    )
    return s


def test_advance_session_resolves_build_handler_via_merged_registry(repo: SqlDifyBuilderRepository, wired) -> None:
    _events, released = wired
    s = _seed_build_session(repo)

    mod.advance_session(s.id, _act("send_goal", 1, text="Build it"), _ACTOR_DICT, "tok-b1")

    stored, _fc = repo.get_session(s.id)
    assert stored.current_state == PcState.BUILD_GOAL_ANALYSIS  # build handler resolved, not a 500
    assert (s.id, "tok-b1") in released


def _seed_edit_session_at_capability(repo: SqlDifyBuilderRepository) -> Session:
    s = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.EDIT,
        current_state=PcState.EDIT_CAPABILITY_CHECK,
    )
    repo.create_session(s, DifyBuilderContext(), [ConversationItem(kind="user", seq=0)])
    return s


def test_advance_session_resolves_edit_handler_via_merged_registry(repo: SqlDifyBuilderRepository, wired) -> None:
    _events, released = wired
    s = _seed_edit_session_at_capability(repo)

    mod.advance_session(s.id, _act("send_edit_goal", 1, text="Tighten risk"), _ACTOR_DICT, "tok-e1")

    stored, _fc = repo.get_session(s.id)
    assert stored.current_state == PcState.EDIT_IMPACT_ANALYSIS  # edit handler resolved, not a 500
    assert (s.id, "tok-e1") in released
