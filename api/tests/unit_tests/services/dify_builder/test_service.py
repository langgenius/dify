"""Unit tests for the ``DifyBuilderService`` usecase (P3b Task 3).

Wires ``SqlDifyBuilderRepository`` (backed by a SQLite in-memory DB, same
fixtures as ``test_engine_on_sql_repo.py``) with a fake in-memory
``session_lock`` and a capturing ``enqueue_fn`` -- the service is
dependency-injected so it stays unit-testable without Celery or the real
Redis-backed ``session_lock`` module.
"""

import json
from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.dify_builder.contract import ActionKind
from core.dify_builder.errors import BadRequestError, BusyError, ConflictError, NotFoundError
from core.dify_builder.models import (
    Action,
    Actor,
    ChecklistError,
    ConversationItem,
    DifyBuilderContext,
    EntryMode,
    Session,
)
from core.dify_builder.state import PcState
from models.base import Base
from services.dify_builder import service as service_module
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.service import AppAccess, DifyBuilderService, resolve_action_kind

TENANT_ID = "11111111-1111-1111-1111-111111111111"
APP_ID = "22222222-2222-2222-2222-222222222222"
ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"
OTHER_ACCOUNT_ID = "44444444-4444-4444-4444-444444444444"
OTHER_TENANT_ID = "55555555-5555-5555-5555-555555555555"


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
def repo(engine: Engine) -> SqlDifyBuilderRepository:
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    return SqlDifyBuilderRepository(factory)


@pytest.fixture
def lock() -> FakeSessionLock:
    return FakeSessionLock()


@pytest.fixture
def enqueued() -> list[tuple]:
    return []


@pytest.fixture
def service(repo: SqlDifyBuilderRepository, lock: FakeSessionLock, enqueued: list[tuple]) -> DifyBuilderService:
    def enqueue_fn(session_id, action, actor, token) -> None:
        enqueued.append((session_id, action, actor, token))

    return DifyBuilderService(repo=repo, session_lock=lock, enqueue_fn=enqueue_fn)


@pytest.fixture
def inmemory_service_factory_raw(repo: SqlDifyBuilderRepository, lock: FakeSessionLock):
    """Build a ``DifyBuilderService`` (in-memory SQLite repo + fake lock) with
    caller-supplied ``subscribe_fn``/``enqueue_fn``, for tests that need to
    observe subscribe/dispatch ordering directly (rather than via the
    capturing ``enqueued`` list the plain ``service`` fixture uses)."""

    def _factory(subscribe_fn=None, enqueue_fn=None) -> tuple[DifyBuilderService, Actor]:
        svc = DifyBuilderService(
            repo=repo,
            session_lock=lock,
            enqueue_fn=enqueue_fn or (lambda *_a, **_k: None),
            subscribe_fn=subscribe_fn,
        )
        return svc, _actor()

    return _factory


class _StateSub:
    """Fake subscription: one terminal ``state`` frame, then closes."""

    def receive(self, timeout=None):  # noqa: ARG002
        return json.dumps({"kind": "state", "version": 2, "session_id": "sid"}).encode()

    def close(self):
        pass


def _business_event(frame: str) -> str:
    assert frame.startswith("event: message\n")
    return json.loads(frame.split("data: ", 1)[1])["event"]


def _actor(account_id: str = ACCOUNT_ID) -> Actor:
    return Actor(account_id=account_id, tenant_id=TENANT_ID)


def test_create_fix_session_dispatches_request_fix_and_holds_lock(
    service: DifyBuilderService, lock: FakeSessionLock, enqueued: list[tuple]
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


def test_create_fix_session_records_failed_run(service: DifyBuilderService, repo: SqlDifyBuilderRepository) -> None:
    """The bridge: ``failed_run_id`` is a Dify workflow-run id, which
    create_fix_session records as an immutable ``original-failed``
    ``DifyBuilderRun``; ``fc.failed_run_id`` points at that row so the async
    diagnose can resolve ``run.dify_run_id`` -> ``dify.node_outputs``."""
    view = service.create_fix_session(APP_ID, _actor(), failed_run_id="  dify-run-abc  ")

    _session, fc = repo.get_session(view.session_id)
    assert fc.failed_run_id  # a DifyBuilderRun id...
    assert fc.failed_run_id != "dify-run-abc"  # ...not the Dify run id itself
    recorded = repo.get_run(fc.failed_run_id)
    assert recorded.kind == "original-failed"
    assert recorded.dify_run_id == "dify-run-abc"  # the Dify run the caller passed
    assert recorded.status == "failed"
    assert recorded.immutable is True


def test_create_checklist_session_records_no_failed_run(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    """Checklist entry has no failed run: ``fc.failed_run_id`` stays empty."""
    view = service.create_fix_session(
        APP_ID, _actor(), checklist_errors=[ChecklistError(node_id="n1", node_type="llm", title="x")]
    )
    _session, fc = repo.get_session(view.session_id)
    assert fc.failed_run_id == ""


def test_create_fix_session_checklist_entry(service: DifyBuilderService) -> None:
    actor = _actor()
    errors = [ChecklistError(node_id="n1", node_type="llm", title="LLM", messages=["missing prompt"])]

    view = service.create_fix_session(APP_ID, actor, checklist_errors=errors)

    assert view.state == "checklist.diagnose"
    assert view.canvas_read_only is True


@pytest.mark.parametrize(
    ("failed_run_id", "checklist_errors"),
    [
        (None, None),
        ("", []),
        ("   ", None),
    ],
)
def test_create_fix_session_requires_failed_run_or_checklist_errors(
    service: DifyBuilderService,
    enqueued: list[tuple],
    failed_run_id,
    checklist_errors,
) -> None:
    with pytest.raises(BadRequestError, match="failed_run_id or checklist_errors is required"):
        service.create_fix_session(
            APP_ID,
            _actor(),
            failed_run_id=failed_run_id,
            checklist_errors=checklist_errors,
        )

    assert enqueued == []


def test_create_build_session_rejects_blank_goal(service: DifyBuilderService, enqueued: list[tuple]) -> None:
    with pytest.raises(BadRequestError, match="goal_text is required"):
        service.create_build_session(APP_ID, _actor(), goal_text="  ")

    assert enqueued == []


def test_create_fix_session_converts_valid_checklist_dicts_before_persisting(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    view = service.create_fix_session(
        APP_ID,
        _actor(),
        checklist_errors=[
            {
                "node_id": "n1",
                "node_type": "llm",
                "title": "Missing prompt",
                "messages": ["prompt is required"],
                "unconnected": False,
                "plugin_missing": False,
            }
        ],
    )

    _session, context = repo.get_session(view.session_id)
    assert context.checklist_errors == [
        ChecklistError(
            node_id="n1",
            node_type="llm",
            title="Missing prompt",
            messages=["prompt is required"],
            unconnected=False,
            plugin_missing=False,
        )
    ]


@pytest.mark.parametrize(
    "entry",
    [
        "not-an-object",
        {},
        {
            "node_id": "n1",
            "node_type": "llm",
            "title": "x",
            "messages": "not-a-list",
            "unconnected": False,
            "plugin_missing": False,
        },
        {
            "node_id": "n1",
            "node_type": "llm",
            "title": "x",
            "messages": [1],
            "unconnected": False,
            "plugin_missing": False,
        },
        {
            "node_id": "n1",
            "node_type": "llm",
            "title": "x",
            "messages": [],
            "unconnected": 0,
            "plugin_missing": False,
        },
        {
            "node_id": "n1",
            "node_type": "llm",
            "title": "x",
            "messages": [],
            "unconnected": False,
            "plugin_missing": False,
            "extra": "field",
        },
    ],
)
def test_create_fix_session_rejects_malformed_checklist_items_before_persisting(
    service: DifyBuilderService, enqueued: list[tuple], entry
) -> None:
    with pytest.raises(BadRequestError, match="invalid checklist_errors item"):
        service.create_fix_session(APP_ID, _actor(), checklist_errors=[entry])

    assert enqueued == []


@pytest.mark.parametrize("app_id", ["", "   ", None, 1])
def test_create_rejects_invalid_app_id_before_persisting(
    service: DifyBuilderService, enqueued: list[tuple], app_id
) -> None:
    with pytest.raises(BadRequestError, match="app_id is required"):
        service.create_build_session(app_id, _actor(), goal_text="Build it")

    assert enqueued == []


def test_create_authorizes_app_before_persisting(
    repo: SqlDifyBuilderRepository, lock: FakeSessionLock, enqueued: list[tuple]
) -> None:
    calls: list[tuple[Actor, str, AppAccess]] = []

    def deny(actor: Actor, app_id: str, access: AppAccess) -> None:
        calls.append((actor, app_id, access))
        raise NotFoundError("app not found")

    svc = DifyBuilderService(repo, lock, lambda *args: enqueued.append(args), authorize_app_fn=deny)

    with pytest.raises(NotFoundError, match="app not found"):
        svc.create_build_session(f"  {APP_ID}  ", _actor(), goal_text="Build it")

    assert calls == [(_actor(), APP_ID, AppAccess.EDIT)]
    assert enqueued == []


def test_submit_action_while_lock_held_raises_busy(
    service: DifyBuilderService,
    repo: SqlDifyBuilderRepository,
    lock: FakeSessionLock,
    enqueued: list[tuple],
) -> None:
    actor = _actor()
    session = _seed_session_at(repo, PcState.FIX_AWAIT_VERIFY)
    assert lock.acquire(session.id) is not None

    # Validation passes, but dispatch's acquire fails because the lock is held.
    with pytest.raises(BusyError):
        service.submit_action(session.id, actor, Action(kind="run_verify", base_version=1))

    assert enqueued == []


def test_submit_action_with_stale_base_version_raises_conflict(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository, enqueued: list[tuple]
) -> None:
    actor = _actor()
    session = _seed_session_at(repo, PcState.FIX_AWAIT_VERIFY)

    with pytest.raises(ConflictError):
        service.submit_action(session.id, actor, Action(kind="run_verify", base_version=999))

    assert enqueued == []


def test_get_session_view_by_non_owner_raises_not_found(service: DifyBuilderService) -> None:
    actor = _actor()
    other = _actor(OTHER_ACCOUNT_ID)
    view = service.create_fix_session(APP_ID, actor, failed_run_id="TR-1")

    with pytest.raises(NotFoundError):
        service.get_session_view(view.session_id, other)


def test_submit_action_by_non_owner_raises_not_found(service: DifyBuilderService) -> None:
    actor = _actor()
    other = _actor(OTHER_ACCOUNT_ID)
    view = service.create_fix_session(APP_ID, actor, failed_run_id="TR-1")

    with pytest.raises(NotFoundError):
        service.submit_action(view.session_id, other, Action(kind="run_verify", base_version=1))


def test_session_access_requires_matching_owner_and_tenant(
    repo: SqlDifyBuilderRepository, lock: FakeSessionLock
) -> None:
    session = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.FIX,
        current_state=PcState.FIX_AWAIT_VERIFY,
    )
    repo.create_session(session, DifyBuilderContext(), [])
    authorizations: list[tuple] = []
    svc = DifyBuilderService(
        repo,
        lock,
        lambda *_args: None,
        authorize_app_fn=lambda *args: authorizations.append(args),
    )
    wrong_tenant_actor = Actor(account_id=ACCOUNT_ID, tenant_id=OTHER_TENANT_ID)

    with pytest.raises(NotFoundError, match="session not found"):
        svc.get_session_view(session.id, wrong_tenant_actor)
    with pytest.raises(NotFoundError, match="session not found"):
        svc.submit_action(session.id, wrong_tenant_actor, Action(kind="run_verify", base_version=1))

    assert authorizations == []


def test_get_session_view_interrupted_reflects_lock_absence(
    service: DifyBuilderService, lock: FakeSessionLock, enqueued: list[tuple]
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


def test_waiting_session_projects_executing_while_worker_lock_is_held(
    service: DifyBuilderService,
    repo: SqlDifyBuilderRepository,
    lock: FakeSessionLock,
) -> None:
    session = _seed_session_at(repo, PcState.FIX_AWAIT_APPROVAL)
    token = lock.acquire(session.id)
    assert token is not None

    locked_view = service.get_session_view(session.id, _actor())
    assert locked_view.run_status == "executing"
    assert locked_view.canvas_read_only is True

    lock.release(session.id, token)
    settled_view = service.get_session_view(session.id, _actor())
    assert settled_view.run_status == "waiting_input"
    assert settled_view.canvas_read_only is False


def test_app_revision_is_projected_and_guards_workflow_dependent_actions(
    repo: SqlDifyBuilderRepository,
    lock: FakeSessionLock,
) -> None:
    current_revision = "hash-1"
    enqueued: list[Action] = []
    svc = DifyBuilderService(
        repo,
        lock,
        lambda _sid, action, _actor, _token: enqueued.append(action),
        get_app_revision_fn=lambda _app_id, _actor: current_revision,
    )
    session = _seed_session_at(repo, PcState.FIX_AWAIT_VERIFY)
    stored, context = repo.get_session(session.id)
    context.last_snapshot_hash = "hash-1"
    repo.compare_and_advance(session.id, stored.version, stored.current_state, context, [])

    view = svc.get_session_view(session.id, _actor())
    assert view.app_revision is not None
    assert view.app_revision.observed == "hash-1"
    assert view.app_revision.current == "hash-1"
    assert view.app_revision.conflicted is False

    current_revision = "hash-2"
    view = svc.get_session_view(session.id, _actor())
    assert view.app_revision is not None
    assert view.app_revision.conflicted is True

    with pytest.raises(BadRequestError, match="base_app_revision is required"):
        svc.submit_action(session.id, _actor(), Action(kind="run_verify", base_version=2))
    with pytest.raises(ConflictError, match="stale app revision"):
        svc.submit_action(
            session.id,
            _actor(),
            Action(kind="run_verify", base_version=2, base_app_revision="hash-1"),
        )

    svc.submit_action(
        session.id,
        _actor(),
        Action(kind="run_verify", base_version=2, base_app_revision="hash-2"),
    )
    assert len(enqueued) == 1


def test_submit_message_wraps_submit_action(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository, lock: FakeSessionLock
) -> None:
    actor = _actor()
    session = _seed_session_at(repo, PcState.FIX_AWAIT_APPROVAL)
    assert lock.acquire(session.id) is not None

    # A waiting-state message is valid, but the held lock proves it routes
    # through submit_action -> dispatch like a plain action.
    with pytest.raises(BusyError):
        service.submit_message(session.id, actor, "hello", base_version=1, client_turn_id="turn-1")


def _seed_free_session(repo: SqlDifyBuilderRepository) -> Session:
    """Create a session directly via the repo (bypassing ``create_fix_session``,
    which would itself call ``dispatch`` -- and hold or fail on the lock)
    so callers get a FREE-lock session with ``version == 1``."""
    s = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.FIX,
        current_state=PcState.FIX_AWAIT_VERIFY,
    )
    repo.create_session(s, DifyBuilderContext(failed_run_id="TR-1"), [ConversationItem(kind="run-context", seq=0)])
    return s


def _seed_session_at(repo: SqlDifyBuilderRepository, state: PcState) -> Session:
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
    repo.create_session(s, DifyBuilderContext(failed_run_id="TR-1"), [ConversationItem(kind="run-context", seq=0)])
    return s


@pytest.mark.parametrize(
    ("state", "kind", "expected_access"),
    [
        (PcState.FIX_AWAIT_VERIFY, "run_verify", AppAccess.TEST_AND_RUN),
        (PcState.BUILD_EXECUTION, "run_test", AppAccess.TEST_AND_RUN),
        (PcState.EDIT_APPLY_CHANGES, "run_affected_tests", AppAccess.TEST_AND_RUN),
        (PcState.BUILD_AWAIT_TESTDATA, "provide_testdata", AppAccess.TEST_AND_RUN),
        (PcState.CHECKLIST_AWAIT_RECHECK, "recheck", AppAccess.TEST_AND_RUN),
        (PcState.BUILD_AWAIT_REPAIR, "approve_repair", AppAccess.TEST_AND_RUN),
        (PcState.FIX_AWAIT_VERIFY, "stop", AppAccess.TEST_AND_RUN),
        (PcState.FIX_AWAIT_DECISION, "publish", AppAccess.RELEASE),
        (PcState.BUILD_REVIEW, "publish_workflow", AppAccess.RELEASE),
        (PcState.EDIT_REVIEW, "publish_workflow", AppAccess.RELEASE),
        (PcState.BUILD_REVIEW, "keep_draft", AppAccess.EDIT),
    ],
)
def test_action_authorization_uses_state_specific_permission_tier(
    repo: SqlDifyBuilderRepository,
    lock: FakeSessionLock,
    state: PcState,
    kind: str,
    expected_access: AppAccess,
) -> None:
    session = _seed_session_at(repo, state)
    accesses: list[AppAccess] = []
    svc = DifyBuilderService(
        repo,
        lock,
        lambda *_args: None,
        authorize_app_fn=lambda _actor, _app_id, access: accesses.append(access),
    )

    _view, expect_advance = svc._prepare_action(session.id, _actor(), Action(kind=kind, base_version=1))

    assert expect_advance is True
    assert accesses[0] == AppAccess.EDIT
    assert accesses[-1] == expected_access


@pytest.mark.parametrize("kind", ["", "unknown"])
def test_submit_action_rejects_missing_unknown_or_wrong_state_action_without_enqueue(
    service: DifyBuilderService,
    repo: SqlDifyBuilderRepository,
    enqueued: list[tuple],
    kind: str,
) -> None:
    session = _seed_session_at(repo, PcState.FIX_AWAIT_DECISION)

    with pytest.raises(BadRequestError):
        service.submit_action(session.id, _actor(), Action(kind=kind, base_version=1))

    persisted, _context = repo.get_session(session.id)
    assert persisted.current_state == PcState.FIX_AWAIT_DECISION
    assert persisted.version == 1
    assert enqueued == []


def test_submit_action_rejects_client_only_action_outside_its_surfaced_state(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository, enqueued: list[tuple]
) -> None:
    session = _seed_session_at(repo, PcState.FIX_AWAIT_VERIFY)

    with pytest.raises(BadRequestError, match="not allowed"):
        service.submit_action(session.id, _actor(), Action(kind="view_changes", base_version=1))

    assert enqueued == []


@pytest.mark.parametrize(
    "action",
    [
        Action(kind="publish", payload=[], base_version=1),
        Action(kind="publish", base_version=True),
        Action(kind="publish", base_version="1"),
        Action(kind="message", payload={"text": 1}, base_version=1),
        Action(kind="message", payload={"text": "   "}, base_version=1),
    ],
)
def test_submit_action_rejects_malformed_action_without_enqueue(
    service: DifyBuilderService,
    repo: SqlDifyBuilderRepository,
    enqueued: list[tuple],
    action: Action,
) -> None:
    session = _seed_session_at(repo, PcState.FIX_AWAIT_DECISION)

    with pytest.raises(BadRequestError):
        service.submit_action(session.id, _actor(), action)

    assert enqueued == []


def test_internal_action_state_guards(
    service: DifyBuilderService,
    repo: SqlDifyBuilderRepository,
    enqueued: list[tuple],
) -> None:
    waiting = _seed_session_at(repo, PcState.FIX_AWAIT_APPROVAL)
    _view, expect_advance = service._prepare_action(
        waiting.id,
        _actor(),
        Action(kind="message", payload={"text": "context", "client_turn_id": "turn-1"}, base_version=1),
    )
    assert expect_advance is True

    working = _seed_session_at(repo, PcState.FIX_DIAGNOSE)
    for kind, payload in (
        ("message", {"text": "context", "client_turn_id": "turn-2"}),
        ("update_model", {}),
        ("check_recovery", {}),
    ):
        with pytest.raises(BadRequestError, match="not allowed"):
            service.submit_action(working.id, _actor(), Action(kind=kind, payload=payload, base_version=1))

    terminal = _seed_session_at(repo, PcState.SUCCESS)
    with pytest.raises(BadRequestError, match="not allowed"):
        service.submit_message(terminal.id, _actor(), "context", base_version=1, client_turn_id="turn-3")
    assert enqueued == []


def test_stop_resume_and_recovery_actions_require_current_context(
    repo: SqlDifyBuilderRepository, lock: FakeSessionLock
) -> None:
    session = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_REVIEW,
    )
    repo.create_session(session, DifyBuilderContext(), [])
    svc = DifyBuilderService(repo, lock, lambda *_args: None)

    svc._prepare_action(session.id, _actor(), Action(kind="stop", base_version=1))
    for kind in ("resume", "recovery_continue", "recovery_restart"):
        with pytest.raises(BadRequestError, match="not allowed"):
            svc._prepare_action(session.id, _actor(), Action(kind=kind, base_version=1))

    _session, context = repo.get_session(session.id)
    context.paused = True
    context.recovery_class = "config_only"
    repo.compare_and_advance(session.id, 1, PcState.BUILD_REVIEW, context, [])

    svc._prepare_action(session.id, _actor(), Action(kind="resume", base_version=2))
    svc._prepare_action(session.id, _actor(), Action(kind="recovery_continue", base_version=2))
    svc._prepare_action(session.id, _actor(), Action(kind="recovery_restart", base_version=2))
    with pytest.raises(BadRequestError, match="not allowed"):
        svc._prepare_action(session.id, _actor(), Action(kind="stop", base_version=2))


def test_get_session_view_actions_for_fix_await_decision(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
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
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    s = _seed_session_at(repo, PcState.FIX_AWAIT_VERIFY)
    actor = _actor()

    view = service.get_session_view(s.id, actor)

    assert [(a.id, a.kind) for a in view.actions] == [
        ("run_validation", ActionKind.PRIMARY),
        ("revert", ActionKind.DESTRUCTIVE),
    ]


def test_get_session_view_actions_empty_for_working_state(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    s = _seed_session_at(repo, PcState.FIX_DIAGNOSE)
    actor = _actor()

    view = service.get_session_view(s.id, actor)

    assert view.actions == []


def test_get_session_view_actions_empty_for_terminal_state(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
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


def test_resolve_action_kind_passes_through_ids_that_match_handler_kinds() -> None:
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
        resolved = {resolve_action_kind(a.id) for a in actions if a.id not in service_module._CLIENT_ONLY_ACTIONS}
        assert resolved <= handled, f"{state}: resolved kinds {resolved} not handled by its handler ({handled})"


def test_submit_action_view_changes_is_a_noop_not_keep_draft(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository, enqueued: list[tuple]
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


def test_submit_action_update_model_persists_without_dispatch(
    service: DifyBuilderService,
    repo: SqlDifyBuilderRepository,
    enqueued: list[tuple],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    s = _seed_session_at(repo, PcState.FIX_AWAIT_VERIFY)
    model_config = {
        "provider": "openai",
        "name": "gpt-4o",
        "mode": "chat",
        "completion_params": {"temperature": 0.2},
    }
    validated: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        service_module,
        "validate_model_config",
        lambda tenant_id, config: validated.append((tenant_id, config)),
    )

    view = service.submit_action(
        s.id,
        _actor(),
        Action(kind="update_model", payload={"model_config": model_config}, base_version=s.version),
    )

    assert validated == [(TENANT_ID, model_config)]
    assert view.version == s.version + 1
    assert view.model is not None
    assert view.model.provider == "openai"
    assert view.model.name == "gpt-4o"
    assert view.model.mode == "chat"
    assert view.model.completion_params == {"temperature": 0.2}
    assert view.conversation[-1].payload["text"] == "Model changed to gpt-4o"
    assert enqueued == []


def test_submit_action_update_model_rejects_missing_config(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    s = _seed_session_at(repo, PcState.FIX_AWAIT_VERIFY)

    with pytest.raises(BadRequestError, match="model_config is required"):
        service.submit_action(
            s.id,
            _actor(),
            Action(kind="update_model", payload={}, base_version=s.version),
        )


def test_submit_action_stream_update_model_emits_terminal_state_frame(
    service: DifyBuilderService,
    repo: SqlDifyBuilderRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``update_model`` settles synchronously and bumps the version. The stream
    MUST emit a terminal ``state`` frame carrying the new version -- otherwise a
    FE that tracks its held version off ``state`` frames keeps the stale value
    and its next action 409s (regression class from the 409 review)."""
    s = _seed_session_at(repo, PcState.FIX_AWAIT_VERIFY)
    model_config = {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}}
    monkeypatch.setattr(service_module, "validate_model_config", lambda _tenant_id, _config: None)

    action = Action(kind="update_model", payload={"model_config": model_config}, base_version=s.version)
    frames = list(service.submit_action_stream(s.id, _actor(), action))

    assert _business_event(frames[0]) == "snapshot"
    state_frames = [f for f in frames if _business_event(f) == "state"]
    assert state_frames, "update_model must emit a terminal state frame with the new version"


def test_submit_action_stream_subscribes_before_dispatch_and_streams(repo: SqlDifyBuilderRepository) -> None:
    lock = FakeSessionLock()
    order: list[str] = []

    class _Sub:
        def receive(self, timeout):  # noqa: ARG002
            return json.dumps({"kind": "state", "version": 2, "session_id": "sid"}).encode()

        def close(self):
            pass

    def fake_subscribe(_sid):
        order.append("subscribe")
        return _Sub()

    def fake_enqueue(*_a, **_k):
        order.append("enqueue")

    s = _seed_session_at(repo, PcState.FIX_AWAIT_VERIFY)
    svc = DifyBuilderService(repo, lock, fake_enqueue, subscribe_fn=fake_subscribe)
    actor = _actor()

    action = Action(kind="run_verify", base_version=s.version)
    gen = svc.submit_action_stream(s.id, actor, action)
    frames = list(gen)

    assert order == ["subscribe", "enqueue"]  # subscribe strictly before dispatch
    assert _business_event(frames[0]) == "snapshot"
    assert any(_business_event(frame) == "state" for frame in frames)


def test_submit_action_stream_raises_conflict_before_streaming(repo: SqlDifyBuilderRepository) -> None:
    lock = FakeSessionLock()
    subscribed: list[str] = []
    s = _seed_session_at(repo, PcState.FIX_AWAIT_VERIFY)
    svc = DifyBuilderService(repo, lock, lambda *_a, **_k: None, subscribe_fn=lambda sid: subscribed.append(sid))
    actor = _actor()

    action = Action(kind="run_verify", base_version=s.version + 99)  # stale
    with pytest.raises(ConflictError):
        svc.submit_action_stream(s.id, actor, action)

    assert subscribed == []  # no subscription opened on a pre-flight error


def test_create_fix_session_stream_subscribes_before_dispatch(inmemory_service_factory_raw) -> None:
    order: list[str] = []
    svc, actor = inmemory_service_factory_raw(
        subscribe_fn=lambda _sid: (order.append("subscribe"), _StateSub())[1],
        enqueue_fn=lambda *_a, **_k: order.append("enqueue"),
    )

    gen = svc.create_fix_session_stream(
        app_id=APP_ID, actor=actor, failed_run_id="run-1", checklist_errors=None, model_config=None
    )
    frames = list(gen)

    assert order == ["subscribe", "enqueue"]
    assert _business_event(frames[0]) == "snapshot"


def test_create_build_session_stream_subscribes_before_dispatch(inmemory_service_factory_raw) -> None:
    order: list[str] = []
    svc, actor = inmemory_service_factory_raw(
        subscribe_fn=lambda _sid: (order.append("subscribe"), _StateSub())[1],
        enqueue_fn=lambda *_a, **_k: order.append("enqueue"),
    )

    gen = svc.create_build_session_stream(app_id=APP_ID, actor=actor, goal_text="Build a report workflow")
    frames = list(gen)

    assert order == ["subscribe", "enqueue"]
    assert _business_event(frames[0]) == "snapshot"


def test_invalid_create_streams_raise_before_subscribe(inmemory_service_factory_raw) -> None:
    subscribed: list[str] = []
    svc, actor = inmemory_service_factory_raw(
        subscribe_fn=lambda sid: subscribed.append(sid),
        enqueue_fn=lambda *_a, **_k: None,
    )

    with pytest.raises(BadRequestError, match="goal_text is required"):
        svc.create_build_session_stream(app_id=APP_ID, actor=actor, goal_text="  ")
    with pytest.raises(BadRequestError, match="goal_text is required"):
        svc.create_edit_session_stream(app_id=APP_ID, actor=actor, goal_text="  ")
    with pytest.raises(BadRequestError, match="failed_run_id or checklist_errors is required"):
        svc.create_fix_session_stream(app_id=APP_ID, actor=actor)

    assert subscribed == []


def test_create_edit_session_stream_subscribes_before_initial_goal_dispatch(inmemory_service_factory_raw) -> None:
    order: list[str] = []
    captured_actions: list[Action] = []

    def enqueue(_session_id, action, _actor, _token) -> None:
        order.append("enqueue")
        captured_actions.append(action)

    svc, actor = inmemory_service_factory_raw(
        subscribe_fn=lambda _sid: (order.append("subscribe"), _StateSub())[1],
        enqueue_fn=enqueue,
    )

    frames = list(
        svc.create_edit_session_stream(
            app_id=APP_ID,
            actor=actor,
            goal_text="Tighten risk handling",
        )
    )

    assert order == ["subscribe", "enqueue"]
    assert captured_actions == [
        Action(kind="send_edit_goal", payload={"text": "Tighten risk handling"}, base_version=1)
    ]
    assert _business_event(frames[0]) == "snapshot"
    assert any(_business_event(frame) == "state" for frame in frames)


@pytest.mark.parametrize(
    ("method_name", "kwargs"),
    [
        ("create_fix_session_stream", {"failed_run_id": "run-1"}),
        ("create_build_session_stream", {"goal_text": "Build it"}),
        ("create_edit_session_stream", {"goal_text": "Edit it"}),
    ],
)
def test_create_stream_closes_subscription_when_snapshot_serialization_fails(
    inmemory_service_factory_raw,
    monkeypatch: pytest.MonkeyPatch,
    method_name: str,
    kwargs: dict,
) -> None:
    class _TrackingSub:
        closed = False

        def close(self):
            self.closed = True

    subscription = _TrackingSub()
    svc, actor = inmemory_service_factory_raw(subscribe_fn=lambda _sid: subscription)
    monkeypatch.setattr(service_module, "asdict", lambda _view: (_ for _ in ()).throw(RuntimeError("projection")))

    with pytest.raises(RuntimeError, match="projection"):
        getattr(svc, method_name)(app_id=APP_ID, actor=actor, **kwargs)

    assert subscription.closed is True


def test_create_stream_closes_subscription_when_snapshot_projection_fails(
    inmemory_service_factory_raw, monkeypatch: pytest.MonkeyPatch
) -> None:
    class _TrackingSub:
        closed = False

        def close(self):
            self.closed = True

    subscription = _TrackingSub()
    svc, actor = inmemory_service_factory_raw(subscribe_fn=lambda _sid: subscription)
    monkeypatch.setattr(svc, "get_session_view", lambda *_args: (_ for _ in ()).throw(RuntimeError("view")))

    with pytest.raises(RuntimeError, match="view"):
        svc.create_build_session_stream(app_id=APP_ID, actor=actor, goal_text="Build it")

    assert subscription.closed is True


def test_dispatch_releases_lock_when_enqueue_fails(repo: SqlDifyBuilderRepository) -> None:
    lock = FakeSessionLock()

    def raising_enqueue(*_args) -> None:
        raise RuntimeError("boom")

    s = _seed_free_session(repo)
    svc = DifyBuilderService(repo, lock, raising_enqueue)
    actor = _actor()

    # dispatch must propagate the enqueue's original exception, not swallow
    # it or turn it into BusyError.
    with pytest.raises(RuntimeError):
        svc.submit_action(s.id, actor, Action(kind="run_verify", base_version=1))

    # ...and it must release the lock it acquired, so the session isn't
    # wedged by a failed enqueue.
    assert lock.exists(s.id) is False
    assert lock.acquire(s.id) is not None


def test_submit_message_constructs_message_action(repo: SqlDifyBuilderRepository) -> None:
    lock = FakeSessionLock()
    captured: list[tuple] = []

    def capturing_enqueue(session_id, action, actor, token) -> None:
        captured.append((session_id, action, actor, token))

    # seeded directly so the lock is FREE and dispatch actually reaches
    # enqueue_fn (after create_fix_session the lock would already be held,
    # and dispatch would raise BusyError before capturing anything).
    s = _seed_free_session(repo)
    svc = DifyBuilderService(repo, lock, capturing_enqueue)
    actor = _actor()

    svc.submit_message(s.id, actor, "hello", base_version=1, client_turn_id="turn-1")

    assert len(captured) == 1
    _sid, action, _dispatched_actor, _token = captured[0]
    assert action.kind == "message"
    assert action.payload == {"text": "hello", "client_turn_id": "turn-1"}
    assert action.base_version == 1


def test_submit_message_rejects_blank_text(service: DifyBuilderService) -> None:
    with pytest.raises(BadRequestError, match="message text is required"):
        service.submit_message("session-1", _actor(), "   ", base_version=1, client_turn_id="turn-1")


def test_actions_for_await_learning() -> None:
    ids = [a.id for a in service_module._actions_for(PcState.BUILD_AWAIT_LEARNING)]
    assert ids == ["accept_learning", "skip_learning"]


def test_create_build_session_stamps_policy(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``create_build_session`` reads
    ``FeatureService.get_features(actor.tenant_id).skill_learning_policy`` and
    stamps it onto ``fc`` at creation. Monkeypatched to a non-default value
    ("automatic", not the ``DifyBuilderContext`` field default "ask") so this
    only passes if the value genuinely round-trips through FeatureService --
    not merely because it matches the field's own default."""
    from services import feature_service as feature_service_module

    monkeypatch.setattr(feature_service_module.dify_config, "DIFY_BUILDER_SKILL_LEARNING_POLICY", "automatic")

    view = service.create_build_session(APP_ID, _actor(), goal_text="Build a report workflow")

    _session, fc = repo.get_session(view.session_id)
    assert fc.skill_learning_policy == "automatic"


def test_create_build_session_bootstraps_at_capability_check_and_dispatches_send_goal(
    service: DifyBuilderService, enqueued: list[tuple]
) -> None:
    view = service.create_build_session(APP_ID, _actor(), goal_text="  Build a report workflow  ")

    assert view.state == "build.capability_check"
    assert view.entry_mode == EntryMode.BUILD
    assert view.version == 1
    assert len(enqueued) == 1
    _sid, action, _actor2, _token = enqueued[0]
    assert action.kind == "send_goal"
    assert action.payload == {"text": "Build a report workflow"}
    assert action.base_version == 1


def _seed_build_at(repo: SqlDifyBuilderRepository, state: PcState) -> Session:
    s = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.BUILD,
        current_state=state,
    )
    repo.create_session(s, DifyBuilderContext(goal_text="Build it"), [ConversationItem(kind="user", seq=0)])
    return s


def test_build_execution_actions_and_run_status(service: DifyBuilderService, repo: SqlDifyBuilderRepository) -> None:
    s = _seed_build_at(repo, PcState.BUILD_EXECUTION)
    view = service.get_session_view(s.id, _actor())
    assert view.run_status == "waiting_input"
    assert view.phase == "modify"
    assert [(a.id, a.kind) for a in view.actions] == [
        ("run_test", ActionKind.PRIMARY),
        ("revert", ActionKind.DESTRUCTIVE),
    ]


def test_build_review_actions(service: DifyBuilderService, repo: SqlDifyBuilderRepository) -> None:
    s = _seed_build_at(repo, PcState.BUILD_REVIEW)
    view = service.get_session_view(s.id, _actor())
    assert [a.id for a in view.actions] == [
        "publish_workflow",
        "keep_draft",
        "continue_adjusting",
        "view_changes",
        "revert",
    ]


def test_build_complete_is_terminal_with_no_actions(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    s = _seed_build_at(repo, PcState.BUILD_COMPLETE)
    view = service.get_session_view(s.id, _actor())
    assert view.run_status == "complete"
    assert view.actions == []


def test_build_waiting_state_actions_resolve_to_handled_kinds() -> None:
    """Every non-client-only Build action id must resolve (via
    resolve_action_kind) to a kind its handler in handlers_build.py branches
    on -- otherwise the button is a dead no-op. approve_plan->approve_repair,
    revert->undo, continue_adjusting/retry_after_revert->re_fix reuse the
    existing global _ACTION_ID_TO_KIND map; the rest pass through."""
    handled: dict[PcState, set[str]] = {
        PcState.BUILD_CAPABILITY_CHECK: {"send_goal"},
        PcState.BUILD_GOAL_ANALYSIS: {"submit_requirements"},
        PcState.BUILD_INITIAL_PLAN: {"find_resources"},
        PcState.BUILD_RESOURCE_RECOMMENDATION: {"confirm_resources"},
        PcState.BUILD_PLAN_APPROVAL: {"approve_repair"},
        PcState.BUILD_EXECUTION: {"run_test", "undo"},
        PcState.BUILD_REVIEW: {"publish_workflow", "keep_draft", "re_fix", "undo"},
        PcState.BUILD_REVERTED: {"re_fix"},
    }
    for state, kinds in handled.items():
        actions = service_module._ACTIONS_FOR[state]
        resolved = {resolve_action_kind(a.id) for a in actions if a.id not in service_module._CLIENT_ONLY_ACTIONS}
        assert resolved <= kinds, f"{state}: resolved {resolved} not handled by its handler ({kinds})"


def test_sql_repo_invalidate_conversation_items(repo: SqlDifyBuilderRepository) -> None:
    s = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.EDIT,
        current_state=PcState.EDIT_REVIEW,
    )
    items = [
        ConversationItem(seq=0, kind="assistant_turn", payload={"turn_id": "t0"}),
        ConversationItem(seq=1, kind="assistant_turn", payload={"turn_id": "t1"}),
        ConversationItem(seq=2, kind="decision", payload={"text": "x"}),
    ]
    repo.create_session(s, DifyBuilderContext(), items)

    repo.invalidate_conversation_items(s.id, from_seq=1)

    by_seq = {i.seq: i for i in repo.list_conversation(s.id)}
    assert "card_state" not in by_seq[0].payload
    assert by_seq[1].payload["card_state"] == "invalidated"
    assert by_seq[2].payload.get("card_state") is None


def _seed_edit_at(repo: SqlDifyBuilderRepository, state: PcState) -> Session:
    s = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.EDIT,
        current_state=state,
    )
    repo.create_session(s, DifyBuilderContext(goal_text="Tighten risk"), [ConversationItem(kind="user", seq=0)])
    return s


def test_create_edit_session_rejects_blank_goal_without_dispatch(
    service: DifyBuilderService, enqueued: list[tuple]
) -> None:
    with pytest.raises(BadRequestError, match="goal_text is required"):
        service.create_edit_session(APP_ID, _actor(), goal_text="  ")

    assert enqueued == []


def test_create_edit_session_seeds_and_dispatches_opening_goal(
    service: DifyBuilderService,
    repo: SqlDifyBuilderRepository,
    enqueued: list[tuple],
) -> None:
    view = service.create_edit_session(APP_ID, _actor(), goal_text="  Tighten risk handling  ")

    assert view.state == "edit.capability_check"
    assert view.entry_mode == EntryMode.EDIT
    assert [(item.kind, item.payload["text"]) for item in view.conversation] == [("user", "Tighten risk handling")]
    assert isinstance(view.conversation[0].payload["turn_id"], str)
    _session, context = repo.get_session(view.session_id)
    assert context.goal_text == "Tighten risk handling"
    assert len(enqueued) == 1
    session_id, action, actor, _token = enqueued[0]
    assert session_id == view.session_id
    assert actor == _actor()
    assert action == Action(kind="send_edit_goal", payload={"text": "Tighten risk handling"}, base_version=1)


def test_edit_apply_changes_actions_and_run_status(service: DifyBuilderService, repo: SqlDifyBuilderRepository) -> None:
    s = _seed_edit_at(repo, PcState.EDIT_APPLY_CHANGES)
    view = service.get_session_view(s.id, _actor())
    assert view.run_status == "waiting_input"
    assert view.phase == "modify"
    assert [(a.id, a.kind) for a in view.actions] == [
        ("run_affected_tests", ActionKind.PRIMARY),
        ("revert", ActionKind.DESTRUCTIVE),
    ]


def test_edit_review_actions(service: DifyBuilderService, repo: SqlDifyBuilderRepository) -> None:
    s = _seed_edit_at(repo, PcState.EDIT_REVIEW)
    view = service.get_session_view(s.id, _actor())
    assert [a.id for a in view.actions] == [
        "publish_workflow",
        "keep_draft",
        "continue_adjusting",
        "view_changes",
        "revert",
    ]


def test_edit_publish_is_terminal_with_no_actions(service: DifyBuilderService, repo: SqlDifyBuilderRepository) -> None:
    s = _seed_edit_at(repo, PcState.EDIT_PUBLISH)
    view = service.get_session_view(s.id, _actor())
    assert view.run_status == "complete"
    assert view.actions == []


def test_edit_waiting_state_actions_resolve_to_handled_kinds() -> None:
    """Every non-client-only Edit action id must resolve (via
    resolve_action_kind) to a kind its handler in handlers_edit.py branches on.
    approve_plan->approve_repair, revert->undo, continue_adjusting/
    retry_after_revert->re_fix reuse the existing global map; the rest pass
    through (send_edit_goal, submit_edit_rules, run_affected_tests, keep_draft,
    publish_workflow)."""
    handled: dict[PcState, set[str]] = {
        PcState.EDIT_CAPABILITY_CHECK: {"send_edit_goal"},
        PcState.EDIT_IMPACT_ANALYSIS: {"submit_edit_rules"},
        PcState.EDIT_PLAN_APPROVAL: {"approve_repair"},
        PcState.EDIT_APPLY_CHANGES: {"run_affected_tests", "undo"},
        PcState.EDIT_REVIEW: {"publish_workflow", "keep_draft", "re_fix", "undo"},
        PcState.EDIT_REVERTED: {"re_fix"},
    }
    for state, kinds in handled.items():
        actions = service_module._ACTIONS_FOR[state]
        resolved = {resolve_action_kind(a.id) for a in actions if a.id not in service_module._CLIENT_ONLY_ACTIONS}
        assert resolved <= kinds, f"{state}: resolved {resolved} not handled by its handler ({kinds})"


def test_get_session_view_surfaces_checkpoint_when_set(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    s = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_EXECUTION,
    )
    repo.create_session(s, DifyBuilderContext(checkpoint_id="cp-123"), [ConversationItem(kind="user", seq=0)])
    view = service.get_session_view(s.id, _actor())
    assert view.checkpoint is not None
    assert view.checkpoint.checkpoint_id == "cp-123"


def test_get_session_view_no_checkpoint_when_unset(service: DifyBuilderService, repo: SqlDifyBuilderRepository) -> None:
    s = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_INITIAL_PLAN,
    )
    repo.create_session(s, DifyBuilderContext(), [ConversationItem(kind="user", seq=0)])
    view = service.get_session_view(s.id, _actor())
    assert view.checkpoint is None


def test_get_session_view_run_status_paused(service: DifyBuilderService, repo: SqlDifyBuilderRepository) -> None:
    s = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.EDIT,
        current_state=PcState.EDIT_REVIEW,
    )
    repo.create_session(s, DifyBuilderContext(paused=True), [ConversationItem(kind="user", seq=0)])
    view = service.get_session_view(s.id, _actor())
    assert view.run_status == "paused"
    assert view.canvas_read_only is False  # editable while paused


def test_recovery_ref_for():
    # A session whose fc has a recovery_class surfaces a RecoveryRef;
    # can_continue/can_restart follow the class.
    from core.dify_builder import recovery
    from core.dify_builder.contract import RecoveryClass

    ref = recovery.recovery_ref_for(str(RecoveryClass.STRUCTURAL_INVALIDATING))
    assert ref is not None
    assert ref.recovery_class == "structural_invalidating"
    assert ref.can_continue is False  # cannot continue when invalidating
    assert ref.can_restart is True

    ref2 = recovery.recovery_ref_for(str(RecoveryClass.UNCHANGED))
    assert ref2 is not None
    assert ref2.can_continue is True
    assert ref2.can_restart is False  # nothing to restart from when unchanged

    assert recovery.recovery_ref_for("") is None

    # the two "keep going either way" classes: both continuing and restarting
    # are offered, and .message comes from the dict-lookup path (recovery.
    # _RECOVERY_MESSAGE), not the RecoveryRef.get(..., "") fallback.
    for cls in (RecoveryClass.CONFIG_ONLY, RecoveryClass.STRUCTURAL_COMPATIBLE):
        ref3 = recovery.recovery_ref_for(str(cls))
        assert ref3 is not None
        assert ref3.can_continue is True
        assert ref3.can_restart is True
        assert ref3.message
        assert ref3.message == recovery._RECOVERY_MESSAGE[cls]


def test_get_session_view_surfaces_recovery_when_set(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    s = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_EXECUTION,
    )
    repo.create_session(s, DifyBuilderContext(recovery_class="config_only"), [ConversationItem(kind="user", seq=0)])
    view = service.get_session_view(s.id, _actor())
    assert view.recovery is not None
    assert view.recovery.recovery_class == "config_only"


def test_get_session_view_no_recovery_when_unset(service: DifyBuilderService, repo: SqlDifyBuilderRepository) -> None:
    s = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_INITIAL_PLAN,
    )
    repo.create_session(s, DifyBuilderContext(), [ConversationItem(kind="user", seq=0)])
    view = service.get_session_view(s.id, _actor())
    assert view.recovery is None


def test_interrupted_working_state_surfaces_recovery_offer(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    s = _seed_session_at(repo, PcState.BUILD_PUBLISH)  # working state, lock unheld -> interrupted
    view = service.get_session_view(s.id, _actor())
    assert view.interrupted is True
    assert view.recovery is not None
    assert view.recovery.can_continue is True  # Retry
    assert view.recovery.can_restart is True  # Start over
    assert view.recovery.recovery_class == ""  # not a drift class


def test_recovery_actions_allowed_at_interrupted_working_state() -> None:
    from core.dify_builder.models import DifyBuilderContext
    from services.dify_builder.service import _internal_action_allowed

    fc = DifyBuilderContext()
    assert _internal_action_allowed(PcState.BUILD_PUBLISH, fc, "recovery_continue") is True
    assert _internal_action_allowed(PcState.BUILD_PUBLISH, fc, "recovery_restart") is True
    # an unrelated action is still rejected at a working state
    assert _internal_action_allowed(PcState.BUILD_PUBLISH, fc, "publish_workflow") is False


def test_repeat_failure_resurfaces_offer_no_wedge(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository, lock: FakeSessionLock, monkeypatch
) -> None:
    """A Retry (recovery_continue) whose handler raises again must not wedge the
    session: the task's generic except publishes a "step failed" event and releases
    the lock in `finally`, and afterward the session still reads as interrupted with
    the recovery offer present -- never a dead end."""
    import tasks.dify_builder_advance_task as advance_mod
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    class RaisingDify(FakeBuildDifyPort):
        def publish(self, _app_id, _actor) -> None:
            raise RuntimeError("boom: publish still broken")

    monkeypatch.setattr(advance_mod, "_build_repo", lambda: repo)
    monkeypatch.setattr(advance_mod, "WorkflowServiceDifyPort", RaisingDify)
    monkeypatch.setattr(advance_mod, "session_lock", lock)
    events: list[tuple[str, dict]] = []
    monkeypatch.setattr(advance_mod.progress_bus, "publish", lambda sid, ev: events.append((sid, ev)))

    s = _seed_session_at(repo, PcState.BUILD_PUBLISH)  # already interrupted: working, lock unheld
    actor = _actor()
    token = lock.acquire(s.id)
    assert token is not None

    action = {"kind": "recovery_continue", "payload": {}, "base_version": s.version}
    advance_mod.advance_session(s.id, action, {"account_id": actor.account_id, "tenant_id": actor.tenant_id}, token)

    assert not lock.exists(s.id)  # lock released -- a stuck lock would wedge the session
    assert ("error", "step failed") in [(ev["kind"], ev.get("error")) for _sid, ev in events]

    view = service.get_session_view(s.id, actor)
    assert view.interrupted is True
    assert view.recovery is not None  # offer resurfaces -- no dead end
    assert view.recovery.can_continue is True
    assert view.recovery.can_restart is True
