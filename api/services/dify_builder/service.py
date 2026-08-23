"""The Dify Builder usecase: session lifecycle + dispatch.

Port of dify-enterprise/server/pkg/enterprise/biz/dify_builder/usecase.go.

Dependency-injected (``repo``, ``session_lock``, ``enqueue_fn`` are
constructor args) so it stays unit-testable without importing the real
Redis-backed ``session_lock`` module or Celery -- those are wired in by the
caller (P3b Task 4: the Flask controller + the Celery task's ``.delay``).
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Protocol
from uuid import uuid4

from core.dify_builder import recovery
from core.dify_builder.contract import Action as UiAction
from core.dify_builder.contract import (
    ActionKind,
    CheckpointRef,
    Phase,
    RecoveryRef,
    RunContextCard,
    RunStatus,
    UserItem,
)
from core.dify_builder.errors import BusyError, ConflictError, NotFoundError
from core.dify_builder.models import (
    Action,
    Actor,
    ChecklistError,
    ConversationItem,
    DifyBuilderContext,
    EntryMode,
    Run,
    Session,
)
from core.dify_builder.ports import Repository
from core.dify_builder.state import PcState, canvas_read_only, is_terminal, is_waiting, is_working

__all__ = ["DifyBuilderService", "SessionLock", "SessionView", "resolve_action_kind"]


@dataclass
class SessionView:
    """Read model returned by the usecase's session-facing methods."""

    session_id: str
    app_id: str
    version: int
    state: str  # str(PcState), e.g. "fix.await_verify"
    canvas_read_only: bool
    run_status: RunStatus
    interrupted: bool
    conversation: list[ConversationItem]
    entry_mode: EntryMode = EntryMode.FIX
    phase: Phase = Phase.UNDERSTAND
    actions: list[UiAction] = field(default_factory=list)
    checkpoint: CheckpointRef | None = None
    recovery: RecoveryRef | None = None


class SessionLock(Protocol):
    """The per-session advance gate. Both the ``session_lock`` module and
    the in-memory fake used in tests satisfy this structurally."""

    def acquire(self, session_id: str) -> str | None: ...

    def release(self, session_id: str, token: str) -> None: ...

    def exists(self, session_id: str) -> bool: ...


_PHASE_FOR: dict[PcState, Phase] = {
    # Fix.
    PcState.FIX_DIAGNOSE: Phase.UNDERSTAND,
    PcState.FIX_PROPOSE: Phase.PLAN,
    PcState.FIX_AWAIT_APPROVAL: Phase.PLAN,
    PcState.FIX_APPLY: Phase.MODIFY,
    PcState.FIX_AWAIT_VERIFY: Phase.TEST,
    PcState.FIX_AWAIT_TESTDATA: Phase.TEST,
    PcState.FIX_VERIFY: Phase.TEST,
    PcState.FIX_AWAIT_DECISION: Phase.REVIEW,
    PcState.FIX_PUBLISH: Phase.PUBLISH,
    # Checklist.
    PcState.CHECKLIST_DIAGNOSE: Phase.UNDERSTAND,
    PcState.CHECKLIST_PROPOSE: Phase.PLAN,
    PcState.CHECKLIST_AWAIT_RECHECK: Phase.TEST,
    # Terminal.
    PcState.SUCCESS: Phase.COMPLETE,
    PcState.FAILED: Phase.COMPLETE,
    # Build.
    PcState.BUILD_CAPABILITY_CHECK: Phase.UNDERSTAND,
    PcState.BUILD_GOAL_ANALYSIS: Phase.CLARIFY,
    PcState.BUILD_INITIAL_PLAN: Phase.PLAN,
    PcState.BUILD_RESOURCE_RECOMMENDATION: Phase.RESOURCES,
    PcState.BUILD_PLAN_APPROVAL: Phase.PLAN,
    PcState.BUILD_EXECUTION: Phase.MODIFY,
    PcState.BUILD_TEST_AND_REPAIR: Phase.TEST,
    PcState.BUILD_REVIEW: Phase.REVIEW,
    PcState.BUILD_PUBLISH: Phase.PUBLISH,
    PcState.BUILD_GOVERNANCE_FEEDBACK: Phase.COMPLETE,
    PcState.BUILD_COMPLETE: Phase.COMPLETE,
    PcState.BUILD_REVERTED: Phase.PLAN,
    # Edit.
    PcState.EDIT_CAPABILITY_CHECK: Phase.UNDERSTAND,
    PcState.EDIT_IMPACT_ANALYSIS: Phase.CLARIFY,
    PcState.EDIT_PLAN_APPROVAL: Phase.PLAN,
    PcState.EDIT_APPLY_CHANGES: Phase.MODIFY,
    PcState.EDIT_TEST_AFFECTED_PATHS: Phase.TEST,
    PcState.EDIT_REVIEW: Phase.REVIEW,
    PcState.EDIT_PUBLISH: Phase.PUBLISH,
    PcState.EDIT_REVERTED: Phase.PLAN,
}


def _phase_for(state: PcState) -> Phase:
    """Map a ``PcState`` to the coarse UX ``Phase`` shown in the panel
    header (spec §2, §7). Defensive fallback for any unmapped state."""
    return _PHASE_FOR.get(state, Phase.UNDERSTAND)


_ACTIONS_FOR: dict[PcState, list[UiAction]] = {
    PcState.FIX_AWAIT_APPROVAL: [
        UiAction(id="approve_plan", label="Approve fix", kind=ActionKind.PRIMARY),
        UiAction(id="reject_repair", label="Reject", kind=ActionKind.DESTRUCTIVE),
    ],
    PcState.FIX_AWAIT_VERIFY: [
        UiAction(id="run_validation", label="Run validation", kind=ActionKind.PRIMARY),
        UiAction(id="revert", label="Revert", kind=ActionKind.DESTRUCTIVE),
    ],
    PcState.FIX_AWAIT_TESTDATA: [
        UiAction(id="provide_testdata", label="Provide test data", kind=ActionKind.PRIMARY),
    ],
    PcState.FIX_AWAIT_DECISION: [
        UiAction(id="publish_fix", label="Publish fix", kind=ActionKind.PRIMARY),
        UiAction(id="view_changes", label="View changes", kind=ActionKind.SECONDARY),
        UiAction(id="revert", label="Revert", kind=ActionKind.DESTRUCTIVE),
    ],
    PcState.CHECKLIST_AWAIT_RECHECK: [
        UiAction(id="recheck", label="Re-check", kind=ActionKind.PRIMARY),
    ],
    # Build (Slice 2). next_state/canvas_event carry the frozen state-map hints.
    PcState.BUILD_CAPABILITY_CHECK: [
        UiAction(id="send_goal", label="Send goal", kind=ActionKind.PRIMARY,
                 next_state="build.goal_analysis", canvas_event="reset_build_canvas"),
    ],
    PcState.BUILD_GOAL_ANALYSIS: [
        UiAction(id="submit_requirements", label="Submit requirements", kind=ActionKind.PRIMARY,
                 next_state="build.initial_plan"),
    ],
    PcState.BUILD_INITIAL_PLAN: [
        UiAction(id="find_resources", label="Find resources", kind=ActionKind.PRIMARY,
                 next_state="build.resource_recommendation"),
    ],
    PcState.BUILD_RESOURCE_RECOMMENDATION: [
        UiAction(id="confirm_resources", label="Confirm resources", kind=ActionKind.PRIMARY,
                 next_state="build.plan_approval"),
    ],
    PcState.BUILD_PLAN_APPROVAL: [
        UiAction(id="approve_plan", label="Approve plan", kind=ActionKind.PRIMARY,
                 next_state="build.execution", canvas_event="create_checkpoint"),
    ],
    PcState.BUILD_EXECUTION: [
        UiAction(id="run_test", label="Run test", kind=ActionKind.PRIMARY,
                 next_state="build.test_and_repair", canvas_event="start_test_run"),
        UiAction(id="revert", label="Revert", kind=ActionKind.DESTRUCTIVE,
                 next_state="build.reverted", canvas_event="revert_checkpoint"),
    ],
    PcState.BUILD_REVIEW: [
        UiAction(id="publish_workflow", label="Publish", kind=ActionKind.PRIMARY,
                 next_state="build.publish", canvas_event="publish_workflow"),
        UiAction(id="keep_draft", label="Keep draft", kind=ActionKind.SECONDARY,
                 next_state="build.governance_feedback", canvas_event="cancel_publish"),
        UiAction(id="continue_adjusting", label="Continue adjusting", kind=ActionKind.SECONDARY,
                 next_state="build.initial_plan", canvas_event="cancel_publish"),
        UiAction(id="view_changes", label="View changes", kind=ActionKind.SECONDARY),
        UiAction(id="revert", label="Revert", kind=ActionKind.DESTRUCTIVE,
                 next_state="build.reverted", canvas_event="revert_checkpoint"),
    ],
    PcState.BUILD_REVERTED: [
        UiAction(id="retry_after_revert", label="Retry", kind=ActionKind.PRIMARY,
                 next_state="build.initial_plan"),
    ],
    # Edit (Slice 3). next_state/canvas_event carry the frozen state-map hints.
    PcState.EDIT_CAPABILITY_CHECK: [
        UiAction(id="send_edit_goal", label="Send", kind=ActionKind.PRIMARY,
                 next_state="edit.impact_analysis"),
    ],
    PcState.EDIT_IMPACT_ANALYSIS: [
        UiAction(id="submit_edit_rules", label="Submit rules", kind=ActionKind.PRIMARY,
                 next_state="edit.plan_approval"),
    ],
    PcState.EDIT_PLAN_APPROVAL: [
        UiAction(id="approve_plan", label="Approve changes", kind=ActionKind.PRIMARY,
                 next_state="edit.apply_changes", canvas_event="create_checkpoint"),
    ],
    PcState.EDIT_APPLY_CHANGES: [
        UiAction(id="run_affected_tests", label="Run affected tests", kind=ActionKind.PRIMARY,
                 next_state="edit.test_affected_paths", canvas_event="start_test_run"),
        UiAction(id="revert", label="Revert", kind=ActionKind.DESTRUCTIVE,
                 next_state="edit.reverted", canvas_event="revert_checkpoint"),
    ],
    PcState.EDIT_REVIEW: [
        UiAction(id="publish_workflow", label="Publish", kind=ActionKind.PRIMARY,
                 next_state="edit.publish", canvas_event="publish_workflow"),
        UiAction(id="keep_draft", label="Keep draft", kind=ActionKind.SECONDARY,
                 next_state="edit.publish", canvas_event="cancel_publish"),
        UiAction(id="continue_adjusting", label="Continue adjusting", kind=ActionKind.SECONDARY,
                 next_state="edit.impact_analysis", canvas_event="cancel_publish"),
        UiAction(id="view_changes", label="View changes", kind=ActionKind.SECONDARY),
        UiAction(id="revert", label="Revert", kind=ActionKind.DESTRUCTIVE,
                 next_state="edit.reverted", canvas_event="revert_checkpoint"),
    ],
    PcState.EDIT_REVERTED: [
        UiAction(id="retry_after_revert", label="Retry", kind=ActionKind.PRIMARY,
                 next_state="edit.plan_approval"),
    ],
}


def _actions_for(state: PcState) -> list[UiAction]:
    return list(_ACTIONS_FOR.get(state, []))  # copy; non-waiting/working/terminal states → []


_ACTION_ID_TO_KIND: dict[str, str] = {
    "approve_plan": "approve_repair",
    "run_validation": "run_verify",
    "publish_fix": "publish",
    "continue_adjusting": "re_fix",
    "revert": "undo",
    "retry_after_revert": "re_fix",
    # provide_testdata / recheck / keep_draft already match handler kinds → passthrough
}


_CLIENT_ONLY_ACTIONS = frozenset({"view_changes"})


def resolve_action_kind(raw: str) -> str:
    """Map a new FE action_id to the engine handler kind; pass through anything
    already a handler kind (legacy {kind:...} back-compat).

    ``view_changes`` is intentionally NOT in the map and must never reach the
    backend -- it is a client-side card toggle (forces
    ``change_set.full_diff_open``). If it were posted at ``fix.await_decision``,
    the handler's default branch (``keep_draft``) would terminate the
    session. The FE handles ``view_changes`` locally.
    """
    return _ACTION_ID_TO_KIND.get(raw, raw)


def _run_status(state: PcState, paused: bool = False) -> RunStatus:
    """Port of Go ``runStatusFor``, widened to the ``RunStatus`` enum (spec
    §2). Deliberate wire-value change from the old string: ``waiting-input``
    (hyphen) -> ``RunStatus.WAITING_INPUT`` = ``"waiting_input"``
    (underscore); the FE only displays ``run_status``, never branches on it.

    Terminal check comes before waiting/working: ``PcState.BUILD_COMPLETE``
    and ``PcState.EDIT_PUBLISH`` are terminal (spec §7.1/§7.2, ``run_status:
    complete``) but are not in ``_WORKING``/``_WAITING`` and are not
    ``SUCCESS``/``FAILED`` -- without this ordering they'd wrongly fall
    through to EXECUTING.

    ``paused`` (Task 7, ``fc.paused``) only applies at a waiting state -- the
    canvas stays editable while paused -- and never overrides a terminal
    outcome (FAILED/COMPLETE win regardless of the flag).
    """
    if state == PcState.FAILED:
        return RunStatus.FAILED
    if is_terminal(state):  # SUCCESS, BUILD_COMPLETE, EDIT_PUBLISH
        return RunStatus.COMPLETE
    if paused and is_waiting(state):
        return RunStatus.PAUSED
    if is_waiting(state):
        return RunStatus.WAITING_INPUT
    if is_working(state):
        return RunStatus.EXECUTING
    return RunStatus.EXECUTING  # defensive; unreachable for classified states


class DifyBuilderService:
    """Session lifecycle (create/view/action/message) + dispatch.

    Port of Go ``usecase.go``'s ``Usecase``.
    """

    def __init__(
        self,
        repo: Repository,
        session_lock: SessionLock,
        enqueue_fn: Callable[[str, Action, Actor, str], None],
    ) -> None:
        self._repo = repo
        self._session_lock = session_lock
        self._enqueue_fn = enqueue_fn

    def create_fix_session(
        self,
        app_id: str,
        actor: Actor,
        failed_run_id: str | None = None,
        checklist_errors: list[ChecklistError] | None = None,
    ) -> SessionView:
        """Port of Go ``CreateFixSession``, extended to record the failed run.

        ``failed_run_id`` is the id of the **Dify workflow run** that failed
        (what the frontend has). In fix mode we record it as an immutable
        ``original-failed`` ``DifyBuilderRun`` and point ``fc.failed_run_id`` at
        that row, so the async ``diagnose`` step can resolve it
        (``repo.get_run(fc.failed_run_id)`` -> ``run.dify_run_id`` ->
        ``dify.node_outputs``). Checklist takes precedence when errors are
        present (no failed run on that path).
        """
        failed_run: Run | None = None
        if checklist_errors:
            entry_mode, state = EntryMode.FIX_CHECKLIST, PcState.CHECKLIST_DIAGNOSE
            fc = DifyBuilderContext(source="checklist", checklist_errors=checklist_errors)
        else:
            entry_mode, state = EntryMode.FIX, PcState.FIX_DIAGNOSE
            failed_run = Run(
                id=str(uuid4()),
                kind="original-failed",
                dify_run_id=failed_run_id or "",
                status="failed",
                immutable=True,
            )
            fc = DifyBuilderContext(failed_run_id=failed_run.id, source="run")

        s = Session(
            app_id=app_id,
            tenant_id=actor.tenant_id,
            owner_account_id=actor.account_id,
            entry_mode=entry_mode,
            current_state=state,
        )
        run_context = RunContextCard(
            run_id=failed_run_id or "", title="", error_code="", message="", trace_ref=""
        )
        items = [run_context.to_item(seq=0, at_version=0)]
        self._repo.create_session(s, fc, items)  # assigns s.id, s.version = 1
        if failed_run is not None:
            # Persist the failed-run record BEFORE dispatch so the enqueued
            # advance's diagnose can resolve fc.failed_run_id.
            self._repo.save_run(s.id, failed_run)

        self.dispatch(s.id, Action(kind="request_fix", base_version=1), actor)
        return self.get_session_view(s.id, actor)

    def create_build_session(self, app_id: str, actor: Actor, goal_text: str) -> SessionView:
        """Start a Build session at build.capability_check and dispatch the
        initial ``send_goal`` (parallels ``create_fix_session``). The goal is
        seeded as the user's opening bubble; the first advance's
        ``handle_capability_check`` analyzes it into requirements."""
        fc = DifyBuilderContext(goal_text=goal_text)
        s = Session(
            app_id=app_id,
            tenant_id=actor.tenant_id,
            owner_account_id=actor.account_id,
            entry_mode=EntryMode.BUILD,
            current_state=PcState.BUILD_CAPABILITY_CHECK,
        )
        items = [UserItem(text=goal_text).to_item(seq=0, at_version=0)]
        self._repo.create_session(s, fc, items)  # assigns s.id, s.version = 1
        self.dispatch(s.id, Action(kind="send_goal", payload={"text": goal_text}, base_version=1), actor)
        return self.get_session_view(s.id, actor)

    def create_edit_session(self, app_id: str, actor: Actor) -> SessionView:
        """Start an Edit session at edit.capability_check WITHOUT dispatching.
        Mock 02-edit.txt:3 -- on open, show history + composer only; do not read
        or lock the canvas. The graph read + impact analysis happen on the first
        send_edit_goal action, not here. Unlike create_build_session, this takes
        no goal and enqueues no advance -- the session simply rests, canvas
        editable, until the user sends their change request."""
        fc = DifyBuilderContext()
        s = Session(
            app_id=app_id,
            tenant_id=actor.tenant_id,
            owner_account_id=actor.account_id,
            entry_mode=EntryMode.EDIT,
            current_state=PcState.EDIT_CAPABILITY_CHECK,
        )
        self._repo.create_session(s, fc, [])  # empty conversation; assigns s.id, s.version = 1
        return self.get_session_view(s.id, actor)

    def get_session_view(self, session_id: str, actor: Actor) -> SessionView:
        """Port of Go ``GetSessionView``."""
        s, fc = self._repo.get_session(session_id)  # raises NotFoundError if absent
        if s.owner_account_id != actor.account_id:
            raise NotFoundError("session not found")  # do not leak existence to non-owners
        items = self._repo.list_conversation(session_id)
        st = s.current_state
        checkpoint = (
            CheckpointRef(checkpoint_id=fc.checkpoint_id, label="Restore point", created_at="")
            if fc.checkpoint_id
            else None
        )
        recovery_ref = recovery.recovery_ref_for(fc.recovery_class)
        return SessionView(
            session_id=s.id,
            app_id=s.app_id,
            version=s.version,
            state=str(st),
            canvas_read_only=canvas_read_only(st),
            run_status=_run_status(st, paused=fc.paused),
            interrupted=is_working(st) and not self._session_lock.exists(session_id),
            conversation=items,
            entry_mode=s.entry_mode,
            phase=_phase_for(st),
            actions=_actions_for(st),
            checkpoint=checkpoint,
            recovery=recovery_ref,
        )

    def submit_action(self, session_id: str, actor: Actor, action: Action) -> SessionView:
        """Port of Go ``SubmitAction``."""
        s, _fc = self._repo.get_session(session_id)
        if s.owner_account_id != actor.account_id:
            raise NotFoundError("session not found")
        if action.kind in _CLIENT_ONLY_ACTIONS:
            # Client-side-only actions (e.g. view_changes toggles a card locally) never
            # reach the engine — dispatching would hit handle_await_decision's keep_draft
            # default and silently terminate the session. Return the current view unchanged.
            return self.get_session_view(session_id, actor)
        if action.base_version != s.version:
            raise ConflictError(f"stale base_version {action.base_version} for session {session_id}")
        self.dispatch(session_id, action, actor)
        return self.get_session_view(session_id, actor)

    def submit_message(self, session_id: str, actor: Actor, text: str, base_version: int) -> SessionView:
        """Port of Go ``SubmitMessage``."""
        return self.submit_action(
            session_id, actor, Action(kind="message", payload={"text": text}, base_version=base_version)
        )

    def dispatch(self, session_id: str, action: Action, actor: Actor) -> None:
        """Port of Go ``dispatch``: acquire-or-busy + enqueue, release on
        enqueue failure."""
        token = self._session_lock.acquire(session_id)
        if token is None:
            raise BusyError(f"session {session_id} is busy")
        try:
            self._enqueue_fn(session_id, action, actor, token)
        except Exception:
            self._session_lock.release(session_id, token)
            raise
