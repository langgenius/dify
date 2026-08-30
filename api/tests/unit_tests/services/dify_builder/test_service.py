"""Unit tests for the ``DifyBuilderService`` usecase (P3b Task 3).

Wires ``SqlDifyBuilderRepository`` (backed by a SQLite in-memory DB, same
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

from core.dify_builder.contract import ActionKind
from core.dify_builder.errors import BusyError, ConflictError, NotFoundError
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
from services.dify_builder.service import DifyBuilderService, resolve_action_kind

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
    view = service.create_fix_session(APP_ID, _actor(), failed_run_id="dify-run-abc")

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


def test_create_fix_session_starts_with_user_message_and_run_context(
    service: DifyBuilderService,
) -> None:
    view = service.create_fix_session(
        APP_ID,
        _actor(),
        failed_run_id="TR-1",
        goal_text="Fix the latest failed run",
    )

    assert [(item.seq, item.kind) for item in view.conversation[:2]] == [
        (0, "user"),
        (1, "run_context"),
    ]
    assert view.conversation[0].payload == {"text": "Fix the latest failed run"}


def test_create_checklist_session_uses_preflight_context(
    service: DifyBuilderService,
) -> None:
    view = service.create_fix_session(
        APP_ID,
        _actor(),
        checklist_errors=[
            ChecklistError(
                node_id="n1",
                node_type="llm",
                title="LLM",
                messages=["Prompt is required"],
            )
        ],
        goal_text="Fix the configuration issues",
    )

    assert [(item.seq, item.kind) for item in view.conversation[:2]] == [
        (0, "user"),
        (1, "preflight_context"),
    ]
    assert view.conversation[1].payload["issues"] == [
        {"node_id": "n1", "label": "Prompt is required", "kind": "required_config"}
    ]


def test_submit_action_while_lock_held_raises_busy(service: DifyBuilderService, enqueued: list[tuple]) -> None:
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
    service: DifyBuilderService, enqueued: list[tuple]
) -> None:
    actor = _actor()
    view = service.create_fix_session(APP_ID, actor, failed_run_id="TR-1")
    assert len(enqueued) == 1

    with pytest.raises(ConflictError):
        service.submit_action(view.session_id, actor, Action(kind="run_verify", base_version=999))

    # the CAS check happens before dispatch -- no new enqueue.
    assert len(enqueued) == 1


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


def test_submit_message_wraps_submit_action(service: DifyBuilderService) -> None:
    actor = _actor()
    view = service.create_fix_session(APP_ID, actor, failed_run_id="TR-1")

    # lock is held from create_fix_session's dispatch, so this must raise
    # BusyError -- proving submit_message routes through submit_action ->
    # dispatch just like a plain action would.
    with pytest.raises(BusyError):
        service.submit_message(view.session_id, actor, "hello", base_version=1)


def _seed_free_session(repo: SqlDifyBuilderRepository) -> Session:
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

    svc.submit_message(s.id, actor, "hello", base_version=1)

    assert len(captured) == 1
    _sid, action, _dispatched_actor, _token = captured[0]
    assert action.kind == "message"
    assert action.payload == {"text": "hello"}
    assert action.base_version == 1


def test_update_model_persists_config_without_dispatch(
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
    monkeypatch.setattr(service_module, "validate_model_config", lambda _tenant_id, _config: None)

    view = service.submit_action(
        s.id,
        _actor(),
        Action(kind="update_model", payload={"model_config": model_config}, base_version=1),
    )

    assert view.version == 2
    assert view.model is not None
    assert view.model.provider == "openai"
    assert view.model.name == "gpt-4o"
    assert view.model.mode == "chat"
    assert view.model.completion_params == {"temperature": 0.2}
    assert view.conversation[-1].kind == "notice"
    assert view.conversation[-1].payload["text"] == "Model changed to gpt-4o"
    assert enqueued == []


def test_update_model_is_rejected_while_session_is_working(
    service: DifyBuilderService,
    repo: SqlDifyBuilderRepository,
) -> None:
    s = _seed_session_at(repo, PcState.FIX_DIAGNOSE)

    with pytest.raises(BusyError):
        service.submit_action(
            s.id,
            _actor(),
            Action(
                kind="update_model",
                payload={"model_config": {"provider": "openai", "name": "gpt-4o"}},
                base_version=1,
            ),
        )


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
    view = service.create_build_session(APP_ID, _actor(), goal_text="Build a report workflow")

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


def test_create_edit_session_rests_at_capability_check_without_dispatch(
    service: DifyBuilderService, enqueued: list[tuple]
) -> None:
    view = service.create_edit_session(APP_ID, _actor())
    assert view.state == "edit.capability_check"
    assert view.entry_mode == EntryMode.EDIT
    assert view.version == 1
    assert view.run_status == "waiting_input"
    assert view.canvas_read_only is False
    assert view.conversation == []  # mock: show history + composer, nothing read yet
    assert enqueued == []  # NO advance dispatched (unlike Build)
    assert [a.id for a in view.actions] == ["send_edit_goal"]


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
