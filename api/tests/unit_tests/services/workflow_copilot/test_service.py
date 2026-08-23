"""Unit tests for the ``WorkflowCopilotService`` usecase (P3b Task 3).

Wires ``SqlCopilotRepository`` (backed by a SQLite in-memory DB, same
fixtures as ``test_engine_on_sql_repo.py``) with a fake in-memory
``session_lock`` and a capturing ``enqueue_fn`` -- the service is
dependency-injected so it stays unit-testable without Celery or the real
Redis-backed ``session_lock`` module.
"""

from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.workflow_copilot.contract import ActionKind
from core.workflow_copilot.errors import BusyError, ConflictError, NotFoundError
from core.workflow_copilot.models import (
    Action,
    Actor,
    ChecklistError,
    ConversationItem,
    CopilotContext,
    EntryMode,
    Session,
)
from core.workflow_copilot.state import PcState
from models.base import Base
from services.workflow_copilot import service as service_module
from services.workflow_copilot.repository import SqlCopilotRepository
from services.workflow_copilot.service import WorkflowCopilotService, resolve_action_kind

TENANT_ID = "11111111-1111-1111-1111-111111111111"
APP_ID = "22222222-2222-2222-2222-222222222222"
ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"
OTHER_ACCOUNT_ID = "44444444-4444-4444-4444-444444444444"


class FakeSessionLock:
    """In-memory stand-in for the Redis-backed ``session_lock`` module."""

    def __init__(self) -> None:
        self._held: dict[str, str] = {}

    def acquire(self, session_id: str) -> str | None:
        if session_id in self._held:
            return None
        token = f"tok-{session_id}"
        self._held[session_id] = token
        return token

    def release(self, session_id: str, token: str) -> None:
        if self._held.get(session_id) == token:
            self._held.pop(session_id, None)

    def exists(self, session_id: str) -> bool:
        return session_id in self._held


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


@pytest.fixture
def lock() -> FakeSessionLock:
    return FakeSessionLock()


@pytest.fixture
def enqueued() -> list[tuple]:
    return []


@pytest.fixture
def service(repo: SqlCopilotRepository, lock: FakeSessionLock, enqueued: list[tuple]) -> WorkflowCopilotService:
    def enqueue_fn(session_id, action, actor, token) -> None:
        enqueued.append((session_id, action, actor, token))

    return WorkflowCopilotService(repo=repo, session_lock=lock, enqueue_fn=enqueue_fn)


def _actor(account_id: str = ACCOUNT_ID) -> Actor:
    return Actor(account_id=account_id, tenant_id=TENANT_ID)


def test_create_fix_session_dispatches_request_fix_and_holds_lock(
    service: WorkflowCopilotService, lock: FakeSessionLock, enqueued: list[tuple]
) -> None:
    actor = _actor()

    view = service.create_fix_session(APP_ID, actor, failed_run_id="TR-1")

    assert view.state == "fix.diagnose"
    assert view.canvas_read_only is True
    assert view.run_status == "executing"
    assert view.app_id == APP_ID
    assert view.version == 1

    # the lock was acquired by dispatch and never released (enqueue_fn is a
    # pure capture -- it does not run the task).
    assert lock.exists(view.session_id) is True

    assert len(enqueued) == 1
    sid, action, dispatched_actor, token = enqueued[0]
    assert sid == view.session_id
    assert action == Action(kind="request_fix", base_version=1)
    assert dispatched_actor == actor
    assert token == f"tok-{view.session_id}"


def test_create_fix_session_records_failed_run(
    service: WorkflowCopilotService, repo: SqlCopilotRepository
) -> None:
    """The bridge: ``failed_run_id`` is a Dify workflow-run id, which
    create_fix_session records as an immutable ``original-failed``
    ``CopilotRun``; ``fc.failed_run_id`` points at that row so the async
    diagnose can resolve ``run.dify_run_id`` -> ``dify.node_outputs``."""
    view = service.create_fix_session(APP_ID, _actor(), failed_run_id="dify-run-abc")

    _session, fc = repo.get_session(view.session_id)
    assert fc.failed_run_id  # a CopilotRun id...
    assert fc.failed_run_id != "dify-run-abc"  # ...not the Dify run id itself
    recorded = repo.get_run(fc.failed_run_id)
    assert recorded.kind == "original-failed"
    assert recorded.dify_run_id == "dify-run-abc"  # the Dify run the caller passed
    assert recorded.status == "failed"
    assert recorded.immutable is True


def test_create_checklist_session_records_no_failed_run(
    service: WorkflowCopilotService, repo: SqlCopilotRepository
) -> None:
    """Checklist entry has no failed run: ``fc.failed_run_id`` stays empty."""
    view = service.create_fix_session(
        APP_ID, _actor(), checklist_errors=[ChecklistError(node_id="n1", node_type="llm", title="x")]
    )
    _session, fc = repo.get_session(view.session_id)
    assert fc.failed_run_id == ""


def test_create_fix_session_checklist_entry(service: WorkflowCopilotService) -> None:
    actor = _actor()
    errors = [ChecklistError(node_id="n1", node_type="llm", title="LLM", messages=["missing prompt"])]

    view = service.create_fix_session(APP_ID, actor, checklist_errors=errors)

    assert view.state == "checklist.diagnose"
    assert view.canvas_read_only is True


def test_submit_action_while_lock_held_raises_busy(
    service: WorkflowCopilotService, enqueued: list[tuple]
) -> None:
    actor = _actor()
    view = service.create_fix_session(APP_ID, actor, failed_run_id="TR-1")
    assert len(enqueued) == 1

    # CAS passes (version is 1), but dispatch's acquire fails because the
    # lock from create_fix_session's dispatch is still held.
    with pytest.raises(BusyError):
        service.submit_action(view.session_id, actor, Action(kind="run_verify", base_version=1))

    # no new enqueue happened for the rejected action.
    assert len(enqueued) == 1


def test_submit_action_with_stale_base_version_raises_conflict(
    service: WorkflowCopilotService, enqueued: list[tuple]
) -> None:
    actor = _actor()
    view = service.create_fix_session(APP_ID, actor, failed_run_id="TR-1")
    assert len(enqueued) == 1

    with pytest.raises(ConflictError):
        service.submit_action(view.session_id, actor, Action(kind="run_verify", base_version=999))

    # the CAS check happens before dispatch -- no new enqueue.
    assert len(enqueued) == 1


def test_get_session_view_by_non_owner_raises_not_found(service: WorkflowCopilotService) -> None:
    actor = _actor()
    other = _actor(OTHER_ACCOUNT_ID)
    view = service.create_fix_session(APP_ID, actor, failed_run_id="TR-1")

    with pytest.raises(NotFoundError):
        service.get_session_view(view.session_id, other)


def test_submit_action_by_non_owner_raises_not_found(service: WorkflowCopilotService) -> None:
    actor = _actor()
    other = _actor(OTHER_ACCOUNT_ID)
    view = service.create_fix_session(APP_ID, actor, failed_run_id="TR-1")

    with pytest.raises(NotFoundError):
        service.submit_action(view.session_id, other, Action(kind="run_verify", base_version=1))


def test_get_session_view_interrupted_reflects_lock_absence(
    service: WorkflowCopilotService, lock: FakeSessionLock, enqueued: list[tuple]
) -> None:
    actor = _actor()
    view = service.create_fix_session(APP_ID, actor, failed_run_id="TR-1")
    sid, _action, _actor2, token = enqueued[0]

    # lock is held (dispatch's acquire succeeded) -- fix.diagnose is a
    # working state, so with the lock held it must NOT be interrupted.
    view = service.get_session_view(sid, actor)
    assert view.state == "fix.diagnose"
    assert view.interrupted is False

    # release the lock out-of-band (simulating a crashed/expired worker) --
    # the working state now reads as interrupted.
    lock.release(sid, token)
    view = service.get_session_view(sid, actor)
    assert view.interrupted is True


def test_submit_message_wraps_submit_action(service: WorkflowCopilotService) -> None:
    actor = _actor()
    view = service.create_fix_session(APP_ID, actor, failed_run_id="TR-1")

    # lock is held from create_fix_session's dispatch, so this must raise
    # BusyError -- proving submit_message routes through submit_action ->
    # dispatch just like a plain action would.
    with pytest.raises(BusyError):
        service.submit_message(view.session_id, actor, "hello", base_version=1)


def _seed_free_session(repo: SqlCopilotRepository) -> Session:
    """Create a session directly via the repo (bypassing ``create_fix_session``,
    which would itself call ``dispatch`` -- and hold or fail on the lock)
    so callers get a FREE-lock session with ``version == 1``."""
    s = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.FIX,
        current_state=PcState.FIX_DIAGNOSE,
    )
    repo.create_session(s, CopilotContext(failed_run_id="TR-1"), [ConversationItem(kind="run-context", seq=0)])
    return s


def _seed_session_at(repo: SqlCopilotRepository, state: PcState) -> Session:
    """Create a session directly via the repo (bypassing ``create_fix_session``)
    at an arbitrary ``PcState``, so ``get_session_view``'s actions-table lookup
    can be tested without driving the whole flow through it."""
    s = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.FIX,
        current_state=state,
    )
    repo.create_session(s, CopilotContext(failed_run_id="TR-1"), [ConversationItem(kind="run-context", seq=0)])
    return s


def test_get_session_view_actions_for_fix_await_decision(
    service: WorkflowCopilotService, repo: SqlCopilotRepository
) -> None:
    s = _seed_session_at(repo, PcState.FIX_AWAIT_DECISION)
    actor = _actor()

    view = service.get_session_view(s.id, actor)

    assert [(a.id, a.kind) for a in view.actions] == [
        ("publish_fix", ActionKind.PRIMARY),
        ("view_changes", ActionKind.SECONDARY),
        ("revert", ActionKind.DESTRUCTIVE),
    ]


def test_get_session_view_actions_for_fix_await_verify(
    service: WorkflowCopilotService, repo: SqlCopilotRepository
) -> None:
    s = _seed_session_at(repo, PcState.FIX_AWAIT_VERIFY)
    actor = _actor()

    view = service.get_session_view(s.id, actor)

    assert [(a.id, a.kind) for a in view.actions] == [
        ("run_validation", ActionKind.PRIMARY),
        ("revert", ActionKind.DESTRUCTIVE),
    ]


def test_get_session_view_actions_empty_for_working_state(
    service: WorkflowCopilotService, repo: SqlCopilotRepository
) -> None:
    s = _seed_session_at(repo, PcState.FIX_DIAGNOSE)
    actor = _actor()

    view = service.get_session_view(s.id, actor)

    assert view.actions == []


def test_get_session_view_actions_empty_for_terminal_state(
    service: WorkflowCopilotService, repo: SqlCopilotRepository
) -> None:
    s = _seed_session_at(repo, PcState.SUCCESS)
    actor = _actor()

    view = service.get_session_view(s.id, actor)

    assert view.actions == []


def test_resolve_action_kind_maps_new_ids_to_handler_kinds() -> None:
    assert resolve_action_kind("run_validation") == "run_verify"
    assert resolve_action_kind("publish_fix") == "publish"
    assert resolve_action_kind("approve_plan") == "approve_repair"
    assert resolve_action_kind("continue_adjusting") == "re_fix"
    assert resolve_action_kind("revert") == "undo"
    assert resolve_action_kind("retry_after_revert") == "re_fix"


def test_resolve_action_kind_passes_through_legacy_and_unmapped_kinds() -> None:
    # already a handler kind (legacy {kind: ...} back-compat)
    assert resolve_action_kind("run_verify") == "run_verify"
    assert resolve_action_kind("recheck") == "recheck"
    assert resolve_action_kind("provide_testdata") == "provide_testdata"
    assert resolve_action_kind("keep_draft") == "keep_draft"


def test_waiting_state_actions_resolve_to_handled_kinds() -> None:
    """For EACH Fix/Checklist waiting state in ``_ACTIONS_FOR``, every
    surfaced non-client-only action id must resolve (via
    ``resolve_action_kind``) to a handler kind that state's handler in
    ``handlers_fix.py`` actually branches on -- otherwise the button is dead
    (falls through to the state's default no-op/branch) rather than doing
    what its label promises.

    Regression for the FIX_AWAIT_APPROVAL ``revert`` dead button:
    ``resolve_action_kind("revert") == "undo"``, but
    ``handle_await_approval`` only branches on ``approve_repair`` /
    ``reject_repair`` -- ``undo`` fell through to the gate's no-op branch,
    so the reject path was unreachable from the FE."""
    handled_kinds: dict[PcState, set[str]] = {
        PcState.FIX_AWAIT_APPROVAL: {"approve_repair", "reject_repair"},
        PcState.FIX_AWAIT_VERIFY: {"run_verify", "undo"},
        PcState.FIX_AWAIT_TESTDATA: {"provide_testdata"},
        # excludes the client-only view_changes, which never reaches the handler.
        PcState.FIX_AWAIT_DECISION: {"publish", "undo"},
        PcState.CHECKLIST_AWAIT_RECHECK: {"recheck"},
    }
    for state, handled in handled_kinds.items():
        actions = service_module._ACTIONS_FOR[state]
        resolved = {
            resolve_action_kind(a.id) for a in actions if a.id not in service_module._CLIENT_ONLY_ACTIONS
        }
        assert resolved <= handled, f"{state}: resolved kinds {resolved} not handled by its handler ({handled})"


def test_submit_action_view_changes_is_a_noop_not_keep_draft(
    service: WorkflowCopilotService, repo: SqlCopilotRepository, enqueued: list[tuple]
) -> None:
    """``view_changes`` is a client-side-only card toggle (forces
    ``change_set.full_diff_open`` in the FE) that is never mapped in
    ``_ACTION_ID_TO_KIND``, so ``resolve_action_kind`` passes it through
    unchanged. If it ever reached ``dispatch`` at ``fix.await_decision``,
    ``handle_await_decision``'s DEFAULT branch (``keep_draft`` ->
    ``PcState.SUCCESS``, terminal) would silently end the session. The
    ``_CLIENT_ONLY_ACTIONS`` guard in ``submit_action`` must intercept it
    before the CAS check/dispatch and return the view unchanged."""
    s = _seed_session_at(repo, PcState.FIX_AWAIT_DECISION)
    actor = _actor()

    view = service.submit_action(s.id, actor, Action(kind="view_changes", base_version=s.version))

    assert view.state == "fix.await_decision"
    assert view.state != "success"
    assert view.version == s.version  # no CAS/dispatch advance happened
    assert view.run_status != "complete"
    assert enqueued == []  # never reached enqueue_fn -- proves it's a no-op, not a dispatched keep_draft


def test_dispatch_releases_lock_when_enqueue_fails(repo: SqlCopilotRepository) -> None:
    lock = FakeSessionLock()

    def raising_enqueue(*_args) -> None:
        raise RuntimeError("boom")

    s = _seed_free_session(repo)
    svc = WorkflowCopilotService(repo, lock, raising_enqueue)
    actor = _actor()

    # dispatch must propagate the enqueue's original exception, not swallow
    # it or turn it into BusyError.
    with pytest.raises(RuntimeError):
        svc.submit_action(s.id, actor, Action(kind="run_verify", base_version=1))

    # ...and it must release the lock it acquired, so the session isn't
    # wedged by a failed enqueue.
    assert lock.exists(s.id) is False
    assert lock.acquire(s.id) is not None


def test_submit_message_constructs_message_action(repo: SqlCopilotRepository) -> None:
    lock = FakeSessionLock()
    captured: list[tuple] = []

    def capturing_enqueue(session_id, action, actor, token) -> None:
        captured.append((session_id, action, actor, token))

    # seeded directly so the lock is FREE and dispatch actually reaches
    # enqueue_fn (after create_fix_session the lock would already be held,
    # and dispatch would raise BusyError before capturing anything).
    s = _seed_free_session(repo)
    svc = WorkflowCopilotService(repo, lock, capturing_enqueue)
    actor = _actor()

    svc.submit_message(s.id, actor, "hello", base_version=1)

    assert len(captured) == 1
    _sid, action, _dispatched_actor, _token = captured[0]
    assert action.kind == "message"
    assert action.payload == {"text": "hello"}
    assert action.base_version == 1
