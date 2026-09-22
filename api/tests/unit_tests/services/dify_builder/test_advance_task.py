"""Tests for the Celery ``advance_session`` task (Task 4).

Runs the real ``Runner``/``fix_registry()`` engine against a SQLite-backed
``SqlDifyBuilderRepository`` -- mirrors the seed pattern from
``test_engine_on_sql_repo.py`` -- but calls the task function directly
(no Celery worker/broker involved) with the module's outbound seams
(``_build_repo``, ``WorkflowServiceDifyPort``, ``progress_bus.publish``,
``session_lock.release``) monkeypatched. Proves the task wires the engine
correctly end to end: it advances the persisted session, publishes node +
terminal ``command_finished`` progress events, and always releases the advance lock --
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
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, StubAgent

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
    port = FakeDifyPort()
    port.workflow_events = [
        {
            "event": "workflow_started",
            "task_id": "task-1",
            "workflow_run_id": "dify-run-1",
            "data": {"id": "dify-run-1", "workflow_id": "workflow-1", "inputs": {}, "created_at": 1},
        }
    ]
    monkeypatch.setattr(mod, "WorkflowServiceDifyPort", lambda: port)
    monkeypatch.setattr(mod, "build_dify_builder_agent", lambda **_kwargs: StubAgent())

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

    state_events = [ev for _sid, ev in events if ev["kind"] == "command_finished"]
    assert len(state_events) == 1, "advance_session must publish exactly one terminal command_finished event"
    last_state_event = state_events[-1]
    assert last_state_event["state"] == "fix.await_verify"
    assert last_state_event["canvas_read_only"] is False
    # The bounded session projection carries state metadata but not history.
    assert last_state_event["phase"] == "test"
    assert last_state_event["run_status"] == "waiting_confirmation"
    assert "conversation" not in last_state_event
    assert last_state_event["conversation_last_seq"] >= 0
    # Task 5a: actions are now data-driven per PcState; fix.await_verify's
    # table entries are run_validation (primary) + revert (destructive).
    assert [a["id"] for a in last_state_event["actions"]] == ["run_validation", "revert"]

    assert not any(ev["kind"] == "commit" for _sid, ev in events)
    assert events[-1][1]["kind"] == "command_finished"

    canvas_events = [ev for _sid, ev in events if ev["kind"] == "canvas"]
    assert canvas_events, "advance_session must publish canvas events once the adapter emits them"
    assert canvas_events[0]["event"] == "apply_error_fix"
    assert canvas_events[0]["session_id"] == s.id
    assert canvas_events[0]["operation_id"]
    assert canvas_events[0]["at_version"] > 1

    progress_events = [ev for _sid, ev in events if ev["kind"] == "progress"]
    assert progress_events, "structured cognition and workflow work must publish visible phase progress"
    assert progress_events[0]["status"] == "running"
    assert progress_events[0]["activity"] == {
        "id": "fix-load-failure",
        "label": "Load the failed run",
        "state": "active",
        "kind": "stage",
        "parent_id": None,
    }
    assert all("prompt" not in str(event).lower() for event in progress_events)

    assert released == [(s.id, "tok-1")]

    # 2) continue driving: run_verify -> fix.await_testdata -> provide_testdata
    #    (mock) -> fix.verify (working, emits node events) -> fix.await_decision.
    stored, _fc = repo.get_session(s.id)
    mod.advance_session(s.id, _act("run_verify", stored.version), _ACTOR_DICT, "tok-2")

    stored, _fc = repo.get_session(s.id)
    mod.advance_session(s.id, _act("provide_testdata", stored.version, mode="mock"), _ACTOR_DICT, "tok-3")

    stored, _fc = repo.get_session(s.id)
    assert stored.current_state == PcState.FIX_AWAIT_DECISION

    workflow_events = [ev for _sid, ev in events if ev["kind"] == "workflow"]
    assert workflow_events, "native run callbacks must reach progress_bus unchanged"
    assert all(event["session_id"] == s.id and event["operation_id"] for event in workflow_events)
    assert workflow_events[0]["payload"]["event"] == "workflow_started"
    assert workflow_events[0]["payload"]["data"]["inputs"] == {}

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
    assert any(ev["error"] == "conflict" and ev["session_id"] == s.id and ev["command_id"] == "" for ev in error_events)

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

    assert timeline[-2:] == ["release", "publish:command_finished"]


def test_terminal_state_projection_failure_publishes_error_frame(
    monkeypatch: pytest.MonkeyPatch,
    repo: SqlDifyBuilderRepository,
) -> None:
    """If the post-advance view projection (get_session_view -> read_graph) or
    the final state publish raises after a SUCCESSFUL advance, the task must not
    let the exception escape with no terminal frame -- that leaves the SSE client
    hanging to the stream deadline with a stale held version (-> 409 on its next
    action). It must fall back to publishing a terminal error frame."""
    monkeypatch.setattr(mod, "_build_repo", lambda: repo)
    monkeypatch.setattr(mod, "WorkflowServiceDifyPort", FakeDifyPort)
    timeline: list[str] = []
    monkeypatch.setattr(
        mod.progress_bus,
        "publish",
        lambda _sid, event: timeline.append(f"publish:{event['kind']}:{event.get('code', '')}"),
    )
    monkeypatch.setattr(
        mod.session_lock,
        "release",
        lambda _sid, _token: timeline.append("release"),
    )

    class _BoomService:
        def __init__(self, *_a, **_k) -> None: ...

        def get_session_view(self, *_a, **_k):
            raise RuntimeError("projection boom")

    monkeypatch.setattr(mod, "DifyBuilderService", _BoomService)
    s = _seed_fix_session(repo)

    # Must NOT raise, and must still emit a terminal frame after releasing the lock.
    mod.advance_session(s.id, _act("request_fix", 1), _ACTOR_DICT, "tok-boom")

    assert timeline[-2:] == ["release", "publish:error:command_finished_unavailable"]


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
    assert kinds == [
        "conversation_item_appended",
        "agent_message",
        "agent_message",
        "command_finished",
    ]
    user_event, delta, finished, _terminal = payloads
    assert user_event["item"]["kind"] == "user"
    assert user_event["item"]["seq"] == 0
    assert delta["turn_id"] == "turn-1"
    assert delta["delta"]
    assert delta["seq"] == 1
    assert delta["at_version"] == 3
    assert delta["done"] is False
    assert finished["turn_id"] == "turn-1"
    assert finished["seq"] == delta["seq"]
    assert finished["delta"] == ""
    assert finished["done"] is True
    items = repo.list_conversation(session.id)
    assert [item.kind for item in items] == ["user", "assistant_turn"]
    assert items[1].payload["reply_text"] == delta["delta"]
    assert released == [(session.id, "tok-message")]


def test_message_failure_keeps_the_durable_user_half_retryable(
    monkeypatch: pytest.MonkeyPatch,
    repo: SqlDifyBuilderRepository,
) -> None:
    monkeypatch.setattr(mod, "_build_repo", lambda: repo)
    monkeypatch.setattr(mod, "WorkflowServiceDifyPort", FakeDifyPort)

    class FailingAgent(StubAgent):
        def respond_to_message(self, _state, _context, _history, _graph, _text, _on_delta=None):
            raise RuntimeError("model unavailable")

    monkeypatch.setattr(mod, "build_dify_builder_agent", lambda **_kwargs: FailingAgent())
    events: list[tuple[str, dict]] = []
    released: list[tuple[str, str]] = []
    monkeypatch.setattr(mod.progress_bus, "publish", lambda sid, event: events.append((sid, event)))
    monkeypatch.setattr(mod.session_lock, "release", lambda sid, token: released.append((sid, token)))
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
        _act("message", 1, text="Retry me", client_turn_id="turn-retry"),
        _ACTOR_DICT,
        "tok-message-failed",
    )

    stored, _context = repo.get_session(session.id)
    items = repo.list_conversation(session.id)
    assert stored.current_state == PcState.FIX_AWAIT_APPROVAL
    assert stored.version == 2
    assert [(item.kind, item.payload.get("turn_id")) for item in items] == [("user", "turn-retry")]
    assert events[-1][1] == {
        "kind": "error",
        "error": "step failed",
        "recoverable": True,
        "session_id": session.id,
        "command_id": "",
    }
    assert released == [(session.id, "tok-message-failed")]

    events.clear()
    monkeypatch.setattr(
        mod,
        "build_dify_builder_agent",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("model setup unavailable")),
    )
    mod.advance_session(
        session.id,
        _act("message", 2, text="Retry me", client_turn_id="turn-retry"),
        _ACTOR_DICT,
        "tok-message-setup-failed",
    )

    still_waiting, _context = repo.get_session(session.id)
    assert still_waiting.current_state == PcState.FIX_AWAIT_APPROVAL
    assert still_waiting.version == 2
    assert [item.kind for item in repo.list_conversation(session.id)] == ["user"]
    assert events[-1][1] == {
        "kind": "error",
        "error": "step failed",
        "recoverable": True,
        "session_id": session.id,
        "command_id": "",
    }
    assert released[-1] == (session.id, "tok-message-setup-failed")

    events.clear()
    monkeypatch.setattr(mod, "build_dify_builder_agent", lambda **_kwargs: StubAgent())
    mod.advance_session(
        session.id,
        _act("message", 2, text="Retry me", client_turn_id="turn-retry"),
        _ACTOR_DICT,
        "tok-message-retry",
    )

    retried, _context = repo.get_session(session.id)
    retried_items = repo.list_conversation(session.id)
    assert retried.current_state == PcState.FIX_AWAIT_APPROVAL
    assert [item.kind for item in retried_items] == ["user", "assistant_turn"]
    assert [item.payload.get("turn_id") for item in retried_items] == [
        "turn-retry",
        "turn-retry",
    ]
    assert events[-1][1]["kind"] == "command_finished"
    assert released[-1] == (session.id, "tok-message-retry")


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
        stored, _context = repo.get_session(s.id)
        assert stored.current_state == PcState.FAILED
        assert any(ev["kind"] == "progress" and ev["status"] == "error" for _sid, ev in events)
        assert not any(ev["kind"] == "commit" for _sid, ev in events)
        # The failure was persisted, but this test also makes read_graph fail,
        # so projecting the authoritative terminal view falls back to an error
        # frame and the client reconciles over GET.
        assert any(ev["kind"] == "error" and ev["error"] == "step failed" for _sid, ev in events)

        assert (s.id, "tok-y") in released
    finally:
        engine.dispose()


def test_stale_worker_failure_does_not_overwrite_a_newer_session_head(
    monkeypatch: pytest.MonkeyPatch,
    repo: SqlDifyBuilderRepository,
    wired,
) -> None:
    events, released = wired
    session = _seed_fix_session(repo)

    def advance_after_newer_worker(_self, session_id, _turn) -> None:
        current, context = repo.get_session(session_id)
        repo.compare_and_advance(
            session_id,
            current.version,
            PcState.FIX_AWAIT_APPROVAL,
            context,
            [],
        )
        raise RuntimeError("old worker failed after losing its lock")

    monkeypatch.setattr(mod.Runner, "advance", advance_after_newer_worker)

    mod.advance_session(session.id, _act("request_fix", 1), _ACTOR_DICT, "tok-stale-worker")

    stored, _context = repo.get_session(session.id)
    assert stored.version == 2
    assert stored.current_state == PcState.FIX_AWAIT_APPROVAL
    assert not any(event["kind"] == "command_finished" and event["state"] == "failed" for _sid, event in events)
    assert events[-1][1] == {
        "kind": "error",
        "error": "conflict",
        "session_id": session.id,
        "command_id": "",
    }
    assert released == [(session.id, "tok-stale-worker")]


def test_observer_publish_failure_is_best_effort_and_terminal_state_is_still_published_once(
    monkeypatch: pytest.MonkeyPatch,
    repo: SqlDifyBuilderRepository,
) -> None:
    monkeypatch.setattr(mod, "_build_repo", lambda: repo)
    monkeypatch.setattr(mod, "WorkflowServiceDifyPort", FakeDifyPort)
    monkeypatch.setattr(mod, "build_dify_builder_agent", lambda **_kwargs: StubAgent())

    events: list[tuple[str, dict]] = []
    released: list[tuple[str, str]] = []

    def publish(session_id: str, event: dict) -> None:
        if event["kind"] in {"canvas", "node", "progress"}:
            raise RuntimeError("progress bus unavailable")
        events.append((session_id, event))

    monkeypatch.setattr(mod.progress_bus, "publish", publish)
    monkeypatch.setattr(mod.session_lock, "release", lambda sid, tok: released.append((sid, tok)))
    s = _seed_fix_session(repo)

    mod.advance_session(s.id, _act("request_fix", 1), _ACTOR_DICT, "tok-best-effort")

    stored, _fc = repo.get_session(s.id)
    assert stored.current_state == PcState.FIX_AWAIT_VERIFY
    assert [event["kind"] for _sid, event in events].count("command_finished") == 1
    assert all(event["kind"] != "error" for _sid, event in events)
    assert events[-1][1]["kind"] == "command_finished"
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


def test_agent_setup_failure_persists_restartable_failed_state(
    monkeypatch: pytest.MonkeyPatch,
    repo: SqlDifyBuilderRepository,
) -> None:
    monkeypatch.setattr(mod, "_build_repo", lambda: repo)
    monkeypatch.setattr(mod, "WorkflowServiceDifyPort", FakeDifyPort)
    monkeypatch.setattr(
        mod,
        "build_dify_builder_agent",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("model unavailable")),
    )
    events: list[tuple[str, dict]] = []
    monkeypatch.setattr(mod.progress_bus, "publish", lambda sid, event: events.append((sid, event)))
    monkeypatch.setattr(mod.session_lock, "release", lambda *_args: None)
    session = _seed_fix_session(repo)

    mod.advance_session(session.id, _act("request_fix", 1), _ACTOR_DICT, "tok-agent")

    stored, _context = repo.get_session(session.id)
    assert stored.current_state == PcState.FAILED
    assert not any(event["kind"] == "commit" for _sid, event in events)
    state = next(event for _sid, event in events if event["kind"] == "command_finished")
    assert state["run_status"] == "failed"
    assert [action["id"] for action in state["actions"]] == ["restart"]


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


def test_start_build_streams_text_before_form_and_reaches_goal_analysis(repo: SqlDifyBuilderRepository, wired) -> None:
    events, released = wired
    s = _seed_build_session(repo)

    mod.advance_session(s.id, _act("start_build", 1), _ACTOR_DICT, "tok-b1")

    stored, _fc = repo.get_session(s.id)
    assert stored.current_state == PcState.BUILD_GOAL_ANALYSIS  # build handler resolved, not a 500
    payloads = [event for _session_id, event in events]
    message_events = [event for event in payloads if event["kind"] == "agent_message"]
    deltas = [event for event in message_events if not event["done"]]
    assert len(deltas) > 1
    assert message_events[-1]["done"] is True
    assert message_events[-1]["delta"] == ""

    assistant = next(item for item in repo.list_conversation(s.id) if item.kind == "assistant_turn")
    assert "".join(event["delta"] for event in deltas) == assistant.payload["reply_text"]
    final_message_index = payloads.index(message_events[-1])
    form_event_index = next(
        index
        for index, event in enumerate(payloads)
        if event["kind"] == "conversation_item_appended" and event["item"]["kind"] == "form"
    )
    assert final_message_index < form_event_index
    assert payloads[-1]["kind"] == "command_finished"
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
