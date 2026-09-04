"""The Dify Builder usecase: session lifecycle + dispatch.

Port of dify-enterprise/server/pkg/enterprise/biz/dify_builder/usecase.go.

Dependency-injected (``repo``, ``session_lock``, ``enqueue_fn`` are
constructor args) so it stays unit-testable without importing the real
Redis-backed ``session_lock`` module or Celery -- those are wired in by the
caller (P3b Task 4: the Flask controller + the Celery task's ``.delay``).
"""

from collections.abc import Callable, Iterator
from dataclasses import asdict
from enum import StrEnum
from typing import Protocol
from uuid import uuid4

from core.dify_builder import recovery
from core.dify_builder.contract import Action as UiAction
from core.dify_builder.contract import (
    ActionKind,
    ActiveInteraction,
    AppRevision,
    CheckpointRef,
    ConversationPage,
    NoticeItem,
    Phase,
    RunContextCard,
    RunStatus,
    SessionModel,
    SessionView,
    UserItem,
)
from core.dify_builder.errors import BadRequestError, BusyError, ConflictError, NotFoundError
from core.dify_builder.models import (
    Action,
    Actor,
    ChecklistError,
    DifyBuilderContext,
    EntryMode,
    Run,
    Session,
)
from core.dify_builder.ports import Repository
from core.dify_builder.state import PcState, canvas_read_only, is_terminal, is_waiting, is_working
from services.dify_builder.agent.model_resolver import validate_model_config
from services.feature_service import FeatureService

__all__ = ["AppAccess", "DifyBuilderService", "SessionLock", "SessionView", "resolve_action_kind"]


class AppAccess(StrEnum):
    """App-scoped permission tier required by one Builder operation.

    Every tier includes the base app-edit check in the production authorizer;
    test/run and release additionally enforce their dedicated RBAC scenes.
    """

    EDIT = "edit"
    TEST_AND_RUN = "test_and_run"
    RELEASE = "release"


class SessionLock(Protocol):
    """The per-session advance gate. Both the ``session_lock`` module and
    the in-memory fake used in tests satisfy this structurally."""

    def acquire(self, session_id: str) -> str | None: ...

    def release(self, session_id: str, token: str) -> None: ...

    def exists(self, session_id: str) -> bool: ...


class _SessionSubscription(Protocol):
    """The subscription surface used by command streams."""

    def receive(self, timeout: float | None = 0.1) -> bytes | None: ...

    def close(self) -> None: ...


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
    PcState.BUILD_AWAIT_TESTDATA: Phase.TEST,
    PcState.BUILD_TEST_AND_REPAIR: Phase.TEST,
    PcState.BUILD_AWAIT_REPAIR: Phase.TEST,
    PcState.BUILD_REVIEW: Phase.REVIEW,
    PcState.BUILD_PUBLISH: Phase.PUBLISH,
    PcState.BUILD_GOVERNANCE_FEEDBACK: Phase.COMPLETE,
    PcState.BUILD_AWAIT_LEARNING: Phase.COMPLETE,
    PcState.BUILD_COMPLETE: Phase.COMPLETE,
    PcState.BUILD_REVERTED: Phase.PLAN,
    # Edit.
    PcState.EDIT_CAPABILITY_CHECK: Phase.UNDERSTAND,
    PcState.EDIT_IMPACT_ANALYSIS: Phase.CLARIFY,
    PcState.EDIT_PLAN_APPROVAL: Phase.PLAN,
    PcState.EDIT_APPLY_CHANGES: Phase.MODIFY,
    PcState.EDIT_AWAIT_TESTDATA: Phase.TEST,
    PcState.EDIT_TEST_AFFECTED_PATHS: Phase.TEST,
    PcState.EDIT_AWAIT_REPAIR: Phase.TEST,
    PcState.EDIT_REVIEW: Phase.REVIEW,
    PcState.EDIT_PUBLISH: Phase.PUBLISH,
    PcState.EDIT_COMPLETE: Phase.COMPLETE,
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
        UiAction(id="keep_draft", label="Keep draft", kind=ActionKind.SECONDARY),
        UiAction(id="continue_adjusting", label="Fix again", kind=ActionKind.SECONDARY),
        UiAction(id="view_changes", label="View changes", kind=ActionKind.SECONDARY),
        UiAction(id="revert", label="Revert", kind=ActionKind.DESTRUCTIVE),
    ],
    PcState.CHECKLIST_AWAIT_RECHECK: [
        UiAction(id="recheck", label="Re-check", kind=ActionKind.PRIMARY),
        UiAction(id="revert", label="Revert", kind=ActionKind.DESTRUCTIVE),
    ],
    PcState.FAILED: [
        UiAction(id="restart", label="Restart from current draft", kind=ActionKind.PRIMARY),
    ],
    # Build (Slice 2). next_state/canvas_event carry the frozen state-map hints.
    PcState.BUILD_CAPABILITY_CHECK: [
        UiAction(
            id="send_goal",
            label="Send goal",
            kind=ActionKind.PRIMARY,
            next_state="build.goal_analysis",
            canvas_event="reset_build_canvas",
        ),
    ],
    PcState.BUILD_GOAL_ANALYSIS: [
        UiAction(
            id="submit_requirements",
            label="Submit requirements",
            kind=ActionKind.PRIMARY,
            next_state="build.initial_plan",
        ),
    ],
    PcState.BUILD_INITIAL_PLAN: [
        UiAction(
            id="find_resources",
            label="Find resources",
            kind=ActionKind.PRIMARY,
            next_state="build.resource_recommendation",
        ),
    ],
    PcState.BUILD_RESOURCE_RECOMMENDATION: [
        UiAction(
            id="confirm_resources", label="Confirm resources", kind=ActionKind.PRIMARY, next_state="build.plan_approval"
        ),
    ],
    PcState.BUILD_PLAN_APPROVAL: [
        UiAction(
            id="approve_plan",
            label="Approve plan",
            kind=ActionKind.PRIMARY,
            next_state="build.execution",
            canvas_event="create_checkpoint",
        ),
    ],
    PcState.BUILD_EXECUTION: [
        UiAction(
            id="run_test",
            label="Run test",
            kind=ActionKind.PRIMARY,
            next_state="build.test_and_repair",
            canvas_event="start_test_run",
        ),
        UiAction(
            id="revert",
            label="Revert",
            kind=ActionKind.DESTRUCTIVE,
            next_state="build.reverted",
            canvas_event="revert_checkpoint",
        ),
    ],
    PcState.BUILD_AWAIT_TESTDATA: [
        UiAction(id="provide_testdata", label="Provide test data", kind=ActionKind.PRIMARY),
    ],
    PcState.BUILD_AWAIT_REPAIR: [
        UiAction(id="approve_plan", label="Apply the fix", kind=ActionKind.PRIMARY, next_state="build.test_and_repair"),
        UiAction(id="keep_draft", label="Keep draft", kind=ActionKind.SECONDARY, next_state="build.review"),
        UiAction(
            id="revert",
            label="Revert",
            kind=ActionKind.DESTRUCTIVE,
            next_state="build.reverted",
            canvas_event="revert_checkpoint",
        ),
    ],
    PcState.BUILD_REVIEW: [
        UiAction(
            id="publish_workflow",
            label="Publish",
            kind=ActionKind.PRIMARY,
            next_state="build.publish",
            canvas_event="publish_workflow",
        ),
        UiAction(
            id="keep_draft",
            label="Keep draft",
            kind=ActionKind.SECONDARY,
            next_state="build.governance_feedback",
            canvas_event="cancel_publish",
        ),
        UiAction(
            id="continue_adjusting",
            label="Continue adjusting",
            kind=ActionKind.SECONDARY,
            next_state="build.initial_plan",
            canvas_event="cancel_publish",
        ),
        UiAction(id="view_changes", label="View changes", kind=ActionKind.SECONDARY),
        UiAction(
            id="revert",
            label="Revert",
            kind=ActionKind.DESTRUCTIVE,
            next_state="build.reverted",
            canvas_event="revert_checkpoint",
        ),
    ],
    PcState.BUILD_REVERTED: [
        UiAction(id="retry_after_revert", label="Retry", kind=ActionKind.PRIMARY, next_state="build.initial_plan"),
    ],
    PcState.BUILD_AWAIT_LEARNING: [
        UiAction(id="accept_learning", label="Add to skills", kind=ActionKind.PRIMARY),
        UiAction(id="skip_learning", label="Skip", kind=ActionKind.SECONDARY),
    ],
    # Edit (Slice 3). next_state/canvas_event carry the frozen state-map hints.
    PcState.EDIT_CAPABILITY_CHECK: [
        UiAction(id="send_edit_goal", label="Send", kind=ActionKind.PRIMARY, next_state="edit.impact_analysis"),
    ],
    PcState.EDIT_IMPACT_ANALYSIS: [
        UiAction(
            id="submit_edit_rules", label="Submit rules", kind=ActionKind.PRIMARY, next_state="edit.plan_approval"
        ),
    ],
    PcState.EDIT_PLAN_APPROVAL: [
        UiAction(
            id="approve_plan",
            label="Approve changes",
            kind=ActionKind.PRIMARY,
            next_state="edit.apply_changes",
            canvas_event="create_checkpoint",
        ),
    ],
    PcState.EDIT_APPLY_CHANGES: [
        UiAction(
            id="run_affected_tests",
            label="Run affected tests",
            kind=ActionKind.PRIMARY,
            next_state="edit.test_affected_paths",
            canvas_event="start_test_run",
        ),
        UiAction(
            id="revert",
            label="Revert",
            kind=ActionKind.DESTRUCTIVE,
            next_state="edit.reverted",
            canvas_event="revert_checkpoint",
        ),
    ],
    PcState.EDIT_AWAIT_TESTDATA: [
        UiAction(id="provide_testdata", label="Provide test data", kind=ActionKind.PRIMARY),
    ],
    PcState.EDIT_AWAIT_REPAIR: [
        UiAction(
            id="approve_plan", label="Apply the fix", kind=ActionKind.PRIMARY, next_state="edit.test_affected_paths"
        ),
        UiAction(id="keep_draft", label="Keep draft", kind=ActionKind.SECONDARY, next_state="edit.review"),
        UiAction(
            id="revert",
            label="Revert",
            kind=ActionKind.DESTRUCTIVE,
            next_state="edit.reverted",
            canvas_event="revert_checkpoint",
        ),
    ],
    PcState.EDIT_REVIEW: [
        UiAction(
            id="publish_workflow",
            label="Publish",
            kind=ActionKind.PRIMARY,
            next_state="edit.publish",
            canvas_event="publish_workflow",
        ),
        UiAction(
            id="keep_draft",
            label="Keep draft",
            kind=ActionKind.SECONDARY,
            next_state="edit.complete",
            canvas_event="cancel_publish",
        ),
        UiAction(
            id="continue_adjusting",
            label="Continue adjusting",
            kind=ActionKind.SECONDARY,
            next_state="edit.impact_analysis",
            canvas_event="cancel_publish",
        ),
        UiAction(id="view_changes", label="View changes", kind=ActionKind.SECONDARY),
        UiAction(
            id="revert",
            label="Revert",
            kind=ActionKind.DESTRUCTIVE,
            next_state="edit.reverted",
            canvas_event="revert_checkpoint",
        ),
    ],
    PcState.EDIT_REVERTED: [
        UiAction(id="retry_after_revert", label="Retry", kind=ActionKind.PRIMARY, next_state="edit.plan_approval"),
    ],
}


def _actions_for(
    state: PcState,
    fc: DifyBuilderContext | None = None,
    *,
    interrupted: bool = False,
    app_revision_conflicted: bool = False,
) -> list[UiAction]:
    """Return only actions legal for the projected lifecycle condition."""
    if interrupted or state == PcState.FAILED:
        return [UiAction(id="restart", label="Restart from current draft", kind=ActionKind.PRIMARY)]
    if fc is not None and fc.paused:
        return [UiAction(id="resume", label="Resume", kind=ActionKind.PRIMARY)]
    recovery_ref = recovery.recovery_ref_for(fc.recovery_class) if fc is not None else None
    if recovery_ref is not None:
        actions: list[UiAction] = []
        if recovery_ref.can_continue:
            actions.append(UiAction(id="recovery_continue", label="Continue", kind=ActionKind.PRIMARY))
        if recovery_ref.can_restart:
            actions.append(UiAction(id="restart", label="Restart from current draft", kind=ActionKind.SECONDARY))
        return actions
    if app_revision_conflicted:
        return [UiAction(id="check_recovery", label="Review draft changes", kind=ActionKind.PRIMARY)]

    actions = list(_ACTIONS_FOR.get(state, []))
    if fc is not None and is_waiting(state):
        actions.append(UiAction(id="pause", label="Pause", kind=ActionKind.SECONDARY))
    return actions


_ACTION_ID_TO_KIND: dict[str, str] = {
    "approve_plan": "approve_repair",
    "run_validation": "run_verify",
    "publish_fix": "publish",
    "continue_adjusting": "re_fix",
    "pause": "stop",
    "revert": "undo",
    "restart": "recovery_restart",
    "retry_after_revert": "re_fix",
    # provide_testdata / recheck / keep_draft already match handler kinds → passthrough
}


_CLIENT_ONLY_ACTIONS = frozenset({"view_changes"})

_ACTIVE_INTERACTION_CARD_FOR_ACTION: dict[str, tuple[str, str | None]] = {
    "submit_requirements": ("form", "build_requirements"),
    "submit_edit_rules": ("form", "edit_rules"),
    "provide_testdata": ("form", "testdata"),
    "confirm_resources": ("resource_select", None),
}

# Handler-facing kinds accepted at each state. This is deliberately explicit:
# several handlers historically treated every unknown kind as a default branch
# (notably fix.await_decision -> keep_draft), so dispatch must never be the
# component that decides whether an action is valid.
_BACKEND_ACTIONS_FOR: dict[PcState, frozenset[str]] = {
    PcState.FIX_AWAIT_APPROVAL: frozenset({"approve_repair", "reject_repair"}),
    PcState.FIX_AWAIT_VERIFY: frozenset({"run_verify", "undo"}),
    PcState.FIX_AWAIT_TESTDATA: frozenset({"provide_testdata"}),
    PcState.FIX_AWAIT_DECISION: frozenset({"publish", "keep_draft", "re_fix", "undo"}),
    PcState.CHECKLIST_AWAIT_RECHECK: frozenset({"recheck", "undo"}),
    PcState.BUILD_CAPABILITY_CHECK: frozenset({"send_goal"}),
    PcState.BUILD_GOAL_ANALYSIS: frozenset({"submit_requirements"}),
    PcState.BUILD_INITIAL_PLAN: frozenset({"find_resources"}),
    PcState.BUILD_RESOURCE_RECOMMENDATION: frozenset({"confirm_resources"}),
    PcState.BUILD_PLAN_APPROVAL: frozenset({"approve_repair"}),
    PcState.BUILD_EXECUTION: frozenset({"run_test", "undo"}),
    PcState.BUILD_AWAIT_TESTDATA: frozenset({"provide_testdata"}),
    PcState.BUILD_AWAIT_REPAIR: frozenset({"approve_repair", "keep_draft", "undo"}),
    PcState.BUILD_REVIEW: frozenset({"publish_workflow", "keep_draft", "re_fix", "undo"}),
    PcState.BUILD_AWAIT_LEARNING: frozenset({"accept_learning", "skip_learning"}),
    PcState.BUILD_REVERTED: frozenset({"re_fix"}),
    PcState.EDIT_CAPABILITY_CHECK: frozenset({"send_edit_goal"}),
    PcState.EDIT_IMPACT_ANALYSIS: frozenset({"submit_edit_rules"}),
    PcState.EDIT_PLAN_APPROVAL: frozenset({"approve_repair"}),
    PcState.EDIT_APPLY_CHANGES: frozenset({"run_affected_tests", "undo"}),
    PcState.EDIT_AWAIT_TESTDATA: frozenset({"provide_testdata"}),
    PcState.EDIT_AWAIT_REPAIR: frozenset({"approve_repair", "keep_draft", "undo"}),
    PcState.EDIT_REVIEW: frozenset({"publish_workflow", "keep_draft", "re_fix", "undo"}),
    PcState.EDIT_REVERTED: frozenset({"re_fix"}),
}

_TEST_AND_RUN_ACTIONS = frozenset(
    {
        "provide_testdata",
        "recheck",
        "run_affected_tests",
        "run_test",
        "run_verify",
        "stop",
        "resume",
    }
)
_RELEASE_ACTIONS = frozenset({"publish", "publish_workflow"})
_REPAIR_THEN_RETEST_STATES = frozenset({PcState.BUILD_AWAIT_REPAIR, PcState.EDIT_AWAIT_REPAIR})


def _app_access_for_action(state: PcState, kind: str) -> AppAccess:
    if kind in _RELEASE_ACTIONS:
        return AppAccess.RELEASE
    if kind in _TEST_AND_RUN_ACTIONS or (kind == "approve_repair" and state in _REPAIR_THEN_RETEST_STATES):
        return AppAccess.TEST_AND_RUN
    return AppAccess.EDIT


def _internal_action_allowed(state: PcState, fc: DifyBuilderContext, kind: str) -> bool:
    """Validate runner/service short-circuits against their product state.

    These commands do not appear in ``_ACTIONS_FOR``, but they are not global:
    transcript/model/recovery commands operate only at a waiting gate, pause
    transitions must change the current pause flag, and recovery choices must
    be present in the current RecoveryRef.
    """
    if state == PcState.FAILED:
        return kind == "recovery_restart"
    if is_working(state):
        # A working state without its advance lock is projected as
        # interrupted. Lock acquisition still protects a live worker from a
        # concurrent restart.
        return kind == "recovery_restart"
    if not is_waiting(state):
        return False
    if fc.paused:
        return kind == "resume"
    recovery_ref = recovery.recovery_ref_for(fc.recovery_class)
    if recovery_ref is not None:
        if kind == "recovery_continue":
            return recovery_ref.can_continue
        if kind == "recovery_restart":
            return recovery_ref.can_restart
        return False
    if kind in {"check_recovery", "message", "update_model"}:
        return True
    if kind == "stop":
        return not fc.paused
    if kind == "resume":
        return fc.paused
    return False


def resolve_action_kind(raw: str) -> str:
    """Map a frontend action_id to the engine handler kind.

    Action IDs that already match their handler kind pass through unchanged.

    ``view_changes`` is intentionally NOT in the map and must never reach the
    backend -- it is a client-side card toggle (forces
    ``change_set.full_diff_open``). If it were posted at ``fix.await_decision``,
    the handler's default branch (``keep_draft``) would terminate the
    session. The FE handles ``view_changes`` locally.
    """
    return _ACTION_ID_TO_KIND.get(raw, raw)


_WAITING_INPUT_STATES = frozenset(
    {
        PcState.FIX_AWAIT_TESTDATA,
        PcState.BUILD_CAPABILITY_CHECK,
        PcState.BUILD_GOAL_ANALYSIS,
        PcState.BUILD_AWAIT_TESTDATA,
        PcState.EDIT_CAPABILITY_CHECK,
        PcState.EDIT_IMPACT_ANALYSIS,
        PcState.EDIT_AWAIT_TESTDATA,
    }
)


def _run_status(state: PcState, paused: bool = False) -> RunStatus:
    """Port of Go ``runStatusFor``, widened to the ``RunStatus`` enum (spec
    §2). Deliberate wire-value change from the old string: ``waiting-input``
    (hyphen) -> ``RunStatus.WAITING_INPUT`` = ``"waiting_input"``
    (underscore).

    Terminal check comes before waiting/working: ``PcState.BUILD_COMPLETE``
    and ``PcState.EDIT_COMPLETE`` are terminal (spec §7.1/§7.2, ``run_status:
    complete``) but are not in ``_WORKING``/``_WAITING`` and are not
    ``SUCCESS``/``FAILED`` -- without this ordering they'd wrongly fall
    through to EXECUTING.

    ``paused`` (Task 7, ``fc.paused``) only applies at a waiting state -- the
    canvas stays editable while paused -- and never overrides a terminal
    outcome (FAILED/COMPLETE win regardless of the flag).
    """
    if state == PcState.FAILED:
        return RunStatus.FAILED
    if is_terminal(state):  # SUCCESS, BUILD_COMPLETE, EDIT_COMPLETE
        return RunStatus.COMPLETE
    if paused and is_waiting(state):
        return RunStatus.PAUSED
    if state in _WAITING_INPUT_STATES:
        return RunStatus.WAITING_INPUT
    if is_waiting(state):
        return RunStatus.WAITING_CONFIRMATION
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
        subscribe_fn: Callable[[str], _SessionSubscription | None] | None = None,
        authorize_app_fn: Callable[[Actor, str, AppAccess], None] | None = None,
        get_app_revision_fn: Callable[[str, Actor], str] | None = None,
    ) -> None:
        self._repo = repo
        self._session_lock = session_lock
        self._enqueue_fn = enqueue_fn
        self._subscribe_fn = subscribe_fn or (lambda _sid: None)
        self._authorize_app_fn = authorize_app_fn or (lambda _actor, _app_id, _access: None)
        self._get_app_revision_fn = get_app_revision_fn or (lambda _app_id, _actor: "")

    def _get_app_revision(self, app_id: str, actor: Actor) -> str:
        revision = self._get_app_revision_fn(app_id, actor)
        return revision if isinstance(revision, str) else ""

    def _authorize_app(self, app_id: str, actor: Actor, access: AppAccess = AppAccess.EDIT) -> str:
        if not isinstance(app_id, str) or not (app_id := app_id.strip()):
            raise BadRequestError("app_id is required")
        self._authorize_app_fn(actor, app_id, access)
        return app_id

    def _get_authorized_session(
        self, session_id: str, actor: Actor, access: AppAccess = AppAccess.EDIT
    ) -> tuple[Session, DifyBuilderContext]:
        s, fc = self._repo.get_session(session_id)
        if s.owner_account_id != actor.account_id or s.tenant_id != actor.tenant_id:
            raise NotFoundError("session not found")
        self._authorize_app(s.app_id, actor, access)
        return s, fc

    def authorize_session(self, session_id: str, actor: Actor) -> None:
        """Authorize a session before opening an SSE subscription.

        The stream route calls this once before subscribing, then reads the
        bounded state after subscription through ``get_session_view`` to
        preserve the no-lost-state-event ordering.
        """
        self._get_authorized_session(session_id, actor)

    @staticmethod
    def _validate_model_config(actor: Actor, model_config: dict | None) -> None:
        if model_config is not None and not isinstance(model_config, dict):
            raise BadRequestError("model_config must be an object")
        if model_config:
            validate_model_config(actor.tenant_id, model_config)

    @staticmethod
    def _parse_checklist_errors(
        checklist_errors: list[ChecklistError] | list[dict] | None,
    ) -> list[ChecklistError] | None:
        if checklist_errors is None:
            return None
        if not isinstance(checklist_errors, list):
            raise BadRequestError("checklist_errors must be a list")

        expected_fields = {"messages", "node_id", "node_type", "plugin_missing", "title", "unconnected"}
        parsed: list[ChecklistError] = []
        for entry in checklist_errors:
            if isinstance(entry, ChecklistError):
                values = {
                    "node_id": entry.node_id,
                    "node_type": entry.node_type,
                    "title": entry.title,
                    "messages": entry.messages,
                    "unconnected": entry.unconnected,
                    "plugin_missing": entry.plugin_missing,
                }
            elif isinstance(entry, dict) and set(entry) == expected_fields:
                values = entry
            else:
                raise BadRequestError("invalid checklist_errors item")

            messages = values["messages"]
            if (
                not isinstance(values["node_id"], str)
                or not isinstance(values["node_type"], str)
                or not isinstance(values["title"], str)
                or not isinstance(messages, list)
                or not all(isinstance(message, str) for message in messages)
                or type(values["unconnected"]) is not bool
                or type(values["plugin_missing"]) is not bool
            ):
                raise BadRequestError("invalid checklist_errors item")
            parsed.append(
                ChecklistError(
                    node_id=values["node_id"],
                    node_type=values["node_type"],
                    title=values["title"],
                    messages=list(messages),
                    unconnected=values["unconnected"],
                    plugin_missing=values["plugin_missing"],
                )
            )
        return parsed

    def _prepare_fix_session(
        self,
        app_id: str,
        actor: Actor,
        failed_run_id: str | None = None,
        checklist_errors: list[ChecklistError] | list[dict] | None = None,
        model_config: dict | None = None,
    ) -> tuple[str, Action]:
        """Shared setup for ``create_fix_session``/``create_fix_session_stream``:
        everything through persisting the session (and the failed-run record)
        up to -- but not including -- the ``request_fix`` dispatch.

        ``failed_run_id`` is the id of the **Dify workflow run** that failed
        (what the frontend has). In fix mode we record it as an immutable
        ``original-failed`` ``DifyBuilderRun`` and point ``fc.failed_run_id`` at
        that row, so the async ``diagnose`` step can resolve it
        (``repo.get_run(fc.failed_run_id)`` -> ``run.dify_run_id`` ->
        ``dify.node_outputs``). Checklist takes precedence when errors are
        present (no failed run on that path).
        """
        if failed_run_id is not None and not isinstance(failed_run_id, str):
            raise BadRequestError("failed_run_id must be a string")
        failed_run_id = (failed_run_id or "").strip() or None
        checklist_errors = self._parse_checklist_errors(checklist_errors)
        if not failed_run_id and not checklist_errors:
            raise BadRequestError("failed_run_id or checklist_errors is required")
        self._validate_model_config(actor, model_config)
        app_id = self._authorize_app(app_id, actor)
        app_revision = self._get_app_revision(app_id, actor)
        failed_run: Run | None = None
        if checklist_errors:
            entry_mode, state = EntryMode.FIX_CHECKLIST, PcState.CHECKLIST_DIAGNOSE
            fc = DifyBuilderContext(
                source="checklist",
                checklist_errors=checklist_errors,
                model_config=model_config or {},
                last_snapshot_hash=app_revision,
            )
        else:
            entry_mode, state = EntryMode.FIX, PcState.FIX_DIAGNOSE
            failed_run = Run(
                id=str(uuid4()),
                kind="original-failed",
                dify_run_id=failed_run_id or "",
                status="failed",
                immutable=True,
            )
            fc = DifyBuilderContext(
                failed_run_id=failed_run.id,
                source="run",
                model_config=model_config or {},
                last_snapshot_hash=app_revision,
            )

        s = Session(
            app_id=app_id,
            tenant_id=actor.tenant_id,
            owner_account_id=actor.account_id,
            entry_mode=entry_mode,
            current_state=state,
        )
        run_context = RunContextCard(run_id=failed_run_id or "", title="", error_code="", message="", trace_ref="")
        items = [run_context.to_item(seq=0, at_version=0)]
        self._repo.create_session(s, fc, items)  # assigns s.id, s.version = 1
        if failed_run is not None:
            # Persist the failed-run record BEFORE dispatch so the enqueued
            # advance's diagnose can resolve fc.failed_run_id.
            self._repo.save_run(s.id, failed_run)

        return s.id, Action(kind="request_fix", base_version=1, base_app_revision=app_revision)

    def create_fix_session(
        self,
        app_id: str,
        actor: Actor,
        failed_run_id: str | None = None,
        checklist_errors: list[ChecklistError] | list[dict] | None = None,
        model_config: dict | None = None,
    ) -> SessionView:
        """Port of Go ``CreateFixSession``, extended to record the failed run."""
        session_id, action = self._prepare_fix_session(app_id, actor, failed_run_id, checklist_errors, model_config)
        if action is not None:
            self.dispatch(session_id, action, actor)
        return self.get_session_view(session_id, actor)

    def create_fix_session_stream(
        self,
        app_id: str,
        actor: Actor,
        failed_run_id: str | None = None,
        checklist_errors: list[ChecklistError] | list[dict] | None = None,
        model_config: dict | None = None,
    ) -> Iterator[str]:
        """Streaming counterpart of ``create_fix_session``: subscribes to the
        session's progress channel BEFORE dispatching the initial
        ``request_fix`` advance, so no progress frames are lost."""
        from services.dify_builder.wiring import stream_advance_frames

        session_id, action = self._prepare_fix_session(app_id, actor, failed_run_id, checklist_errors, model_config)
        subscription = self._subscribe_fn(session_id)  # BEFORE dispatch
        try:
            self.dispatch(session_id, action, actor)
            view_dict = asdict(self.get_session_view(session_id, actor))
        except Exception:
            if subscription is not None:
                subscription.close()
            raise
        return stream_advance_frames(view_dict, subscription, expect_advance=True)

    def _prepare_build_session(
        self, app_id: str, actor: Actor, goal_text: str, model_config: dict | None = None
    ) -> tuple[str, Action]:
        """Shared setup for ``create_build_session``/``create_build_session_stream``:
        everything through persisting the session up to -- but not including --
        the ``send_goal`` dispatch."""
        if not isinstance(goal_text, str) or not (goal_text := goal_text.strip()):
            raise BadRequestError("goal_text is required")
        self._validate_model_config(actor, model_config)
        app_id = self._authorize_app(app_id, actor)
        app_revision = self._get_app_revision(app_id, actor)
        policy = FeatureService.get_features(actor.tenant_id).skill_learning_policy
        fc = DifyBuilderContext(
            goal_text=goal_text,
            skill_learning_policy=policy,
            model_config=model_config or {},
            last_snapshot_hash=app_revision,
        )
        s = Session(
            app_id=app_id,
            tenant_id=actor.tenant_id,
            owner_account_id=actor.account_id,
            entry_mode=EntryMode.BUILD,
            current_state=PcState.BUILD_CAPABILITY_CHECK,
        )
        items = [UserItem(text=goal_text, turn_id=str(uuid4())).to_item(seq=0, at_version=0)]
        self._repo.create_session(s, fc, items)  # assigns s.id, s.version = 1
        return s.id, Action(
            kind="send_goal",
            payload={"text": goal_text},
            base_version=1,
            base_app_revision=app_revision,
        )

    def create_build_session(
        self, app_id: str, actor: Actor, goal_text: str, model_config: dict | None = None
    ) -> SessionView:
        """Start a Build session at build.capability_check and dispatch the
        initial ``send_goal`` (parallels ``create_fix_session``). The goal is
        seeded as the user's opening bubble; the first advance's
        ``handle_capability_check`` analyzes it into requirements."""
        session_id, action = self._prepare_build_session(app_id, actor, goal_text, model_config)
        if action is not None:
            self.dispatch(session_id, action, actor)
        return self.get_session_view(session_id, actor)

    def create_build_session_stream(
        self, app_id: str, actor: Actor, goal_text: str, model_config: dict | None = None
    ) -> Iterator[str]:
        """Streaming counterpart of ``create_build_session``: subscribes BEFORE
        dispatching the initial ``send_goal`` advance."""
        from services.dify_builder.wiring import stream_advance_frames

        session_id, action = self._prepare_build_session(app_id, actor, goal_text, model_config)
        subscription = self._subscribe_fn(session_id)  # BEFORE dispatch
        try:
            self.dispatch(session_id, action, actor)
            view_dict = asdict(self.get_session_view(session_id, actor))
        except Exception:
            if subscription is not None:
                subscription.close()
            raise
        return stream_advance_frames(view_dict, subscription, expect_advance=True)

    def _prepare_edit_session(
        self,
        app_id: str,
        actor: Actor,
        goal_text: str,
        model_config: dict | None = None,
    ) -> tuple[str, Action]:
        """Shared setup for ``create_edit_session``/``create_edit_session_stream``:
        validate and persist the opening goal, then return the initial
        ``send_edit_goal`` action for the caller to dispatch.
        """
        if not isinstance(goal_text, str) or not (goal_text := goal_text.strip()):
            raise BadRequestError("goal_text is required")
        self._validate_model_config(actor, model_config)
        app_id = self._authorize_app(app_id, actor)
        app_revision = self._get_app_revision(app_id, actor)
        fc = DifyBuilderContext(
            goal_text=goal_text,
            model_config=model_config or {},
            last_snapshot_hash=app_revision,
        )
        s = Session(
            app_id=app_id,
            tenant_id=actor.tenant_id,
            owner_account_id=actor.account_id,
            entry_mode=EntryMode.EDIT,
            current_state=PcState.EDIT_CAPABILITY_CHECK,
        )
        items = [UserItem(text=goal_text, turn_id=str(uuid4())).to_item(seq=0, at_version=0)]
        self._repo.create_session(s, fc, items)  # assigns s.id, s.version = 1
        return s.id, Action(
            kind="send_edit_goal",
            payload={"text": goal_text},
            base_version=1,
            base_app_revision=app_revision,
        )

    def create_edit_session(
        self,
        app_id: str,
        actor: Actor,
        goal_text: str,
        model_config: dict | None = None,
    ) -> SessionView:
        """Start an Edit session and dispatch its opening goal in one command.

        The goal is seeded as the opening user bubble and the initial
        ``send_edit_goal`` advance reads the graph and analyzes impact.
        """
        session_id, action = self._prepare_edit_session(app_id, actor, goal_text, model_config)
        self.dispatch(session_id, action, actor)
        return self.get_session_view(session_id, actor)

    def create_edit_session_stream(
        self,
        app_id: str,
        actor: Actor,
        goal_text: str,
        model_config: dict | None = None,
    ) -> Iterator[str]:
        """Streaming counterpart of ``create_edit_session``.

        Subscribe before dispatching ``send_edit_goal`` and relay through its
        terminal frame.
        """
        from services.dify_builder.wiring import stream_advance_frames

        session_id, action = self._prepare_edit_session(app_id, actor, goal_text, model_config)
        subscription = self._subscribe_fn(session_id)  # BEFORE dispatch
        try:
            self.dispatch(session_id, action, actor)
            view_dict = asdict(self.get_session_view(session_id, actor))
        except Exception:
            if subscription is not None:
                subscription.close()
            raise
        return stream_advance_frames(view_dict, subscription, expect_advance=True)

    def get_session_view(self, session_id: str, actor: Actor) -> SessionView:
        """Return the bounded session projection; history has its own API."""
        s, fc = self._get_authorized_session(session_id, actor)
        return self._build_session_view(s, fc)

    def get_conversation_page(
        self,
        session_id: str,
        actor: Actor,
        *,
        limit: int,
        before_seq: int | None = None,
        after_seq: int | None = None,
    ) -> ConversationPage:
        if type(limit) is not int or not 1 <= limit <= 100:
            raise BadRequestError("limit must be between 1 and 100")
        if before_seq is not None and (type(before_seq) is not int or before_seq < 0):
            raise BadRequestError("before_seq must be a non-negative integer")
        if after_seq is not None and (type(after_seq) is not int or after_seq < -1):
            raise BadRequestError("after_seq must be an integer greater than or equal to -1")
        if before_seq is not None and after_seq is not None:
            raise BadRequestError("before_seq and after_seq are mutually exclusive")
        self._get_authorized_session(session_id, actor)
        return self._repo.list_conversation_page(
            session_id,
            limit=limit,
            before_seq=before_seq,
            after_seq=after_seq,
        )

    def _active_interaction_for(
        self, session_id: str, version: int, actions: list[UiAction]
    ) -> ActiveInteraction | None:
        for action in actions:
            card_contract = _ACTIVE_INTERACTION_CARD_FOR_ACTION.get(action.id)
            if card_contract is None:
                continue
            card_kind, expected_variant = card_contract
            card = self._repo.get_latest_conversation_item(session_id, frozenset({card_kind}))
            if card is None:
                return None
            if expected_variant is not None and card.payload.get("variant") != expected_variant:
                return None
            return ActiveInteraction(action_id=action.id, card=card, valid_at_version=version)
        return None

    def _build_session_view(self, s: Session, fc: DifyBuilderContext) -> SessionView:
        st = s.current_state
        lock_held = self._session_lock.exists(s.id)
        current_app_revision = self._get_app_revision(
            s.app_id,
            Actor(account_id=s.owner_account_id, tenant_id=s.tenant_id),
        )
        app_revision_conflicted = bool(
            fc.last_snapshot_hash and current_app_revision and fc.last_snapshot_hash != current_app_revision
        )
        interrupted = is_working(st) and not lock_held
        actions = _actions_for(
            st,
            fc,
            interrupted=interrupted,
            app_revision_conflicted=app_revision_conflicted,
        )
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
            canvas_read_only=lock_held or canvas_read_only(st),
            run_status=(
                RunStatus.THINKING
                if lock_held and is_waiting(st)
                else RunStatus.EXECUTING
                if lock_held
                else _run_status(st, paused=fc.paused)
            ),
            interrupted=interrupted,
            conversation_last_seq=fc.next_seq - 1,
            entry_mode=s.entry_mode,
            phase=_phase_for(st),
            actions=actions,
            active_interaction=self._active_interaction_for(s.id, s.version, actions),
            checkpoint=checkpoint,
            recovery=recovery_ref,
            model=(
                SessionModel(
                    provider=fc.model_config.get("provider", ""),
                    name=fc.model_config.get("name", ""),
                    mode=fc.model_config.get("mode", ""),
                    completion_params=fc.model_config.get("completion_params", {}),
                )
                if fc.model_config
                else None
            ),
            app_revision=AppRevision(
                observed=fc.last_snapshot_hash,
                current=current_app_revision,
                conflicted=app_revision_conflicted,
            ),
        )

    def _prepare_action(self, session_id: str, actor: Actor, action: Action) -> tuple[SessionView, bool]:
        """Shared synchronous validation + settle for ``submit_action`` and the
        streaming submit methods. Returns ``(view, expect_advance)``:
        ``expect_advance`` is ``True`` only when the caller must still call
        ``dispatch`` (this method never dispatches itself, so a streaming
        caller can subscribe before the advance is enqueued)."""
        kind = action.kind.strip() if isinstance(action.kind, str) else ""
        if not kind:
            raise BadRequestError("action kind is required")
        action.kind = kind
        if not isinstance(action.payload, dict):
            raise BadRequestError("action payload must be an object")
        if type(action.base_version) is not int:
            raise BadRequestError("base_version must be an integer")
        if not isinstance(action.base_app_revision, str):
            raise BadRequestError("base_app_revision must be a string")
        if action.kind == "message":
            text = action.payload.get("text")
            if not isinstance(text, str) or not (text := text.strip()):
                raise BadRequestError("message text is required")
            client_turn_id = action.payload.get("client_turn_id")
            if not isinstance(client_turn_id, str) or not (client_turn_id := client_turn_id.strip()):
                raise BadRequestError("client_turn_id is required")
            if len(client_turn_id) > 128:
                raise BadRequestError("client_turn_id is too long")
            action.payload = {**action.payload, "text": text, "client_turn_id": client_turn_id}

        s, fc = self._get_authorized_session(session_id, actor)
        if action.kind == "message":
            client_turn_id = action.payload["client_turn_id"]
            turn_kinds = self._repo.get_conversation_turn_kinds(session_id, client_turn_id)
            if "assistant_turn" in turn_kinds:
                return self._build_session_view(s, fc), False
            if "user" in turn_kinds:
                action.base_version = s.version
        surfaced_client_actions = {ui_action.id for ui_action in _ACTIONS_FOR.get(s.current_state, [])}
        lifecycle_limited = bool(
            fc.paused or fc.recovery_class or is_working(s.current_state) or is_terminal(s.current_state)
        )
        internal_allowed = _internal_action_allowed(s.current_state, fc, action.kind)
        if action.kind in _CLIENT_ONLY_ACTIONS:
            if action.kind not in surfaced_client_actions:
                raise BadRequestError(f"action {action.kind} is not allowed in state {s.current_state}")
        elif not internal_allowed and (
            lifecycle_limited or action.kind not in _BACKEND_ACTIONS_FOR.get(s.current_state, frozenset())
        ):
            raise BadRequestError(f"action {action.kind} is not allowed in state {s.current_state}")

        access = _app_access_for_action(s.current_state, action.kind)
        if access != AppAccess.EDIT:
            self._authorize_app(s.app_id, actor, access)
        if action.base_version != s.version:
            raise ConflictError(f"stale base_version {action.base_version} for session {session_id}")
        current_app_revision = self._get_app_revision(s.app_id, actor)
        app_revision_conflicted = bool(
            fc.last_snapshot_hash and current_app_revision and fc.last_snapshot_hash != current_app_revision
        )
        if action.kind not in {"message", "update_model"}:
            if current_app_revision and not action.base_app_revision:
                raise BadRequestError("base_app_revision is required")
            if action.base_app_revision and action.base_app_revision != current_app_revision:
                raise ConflictError(f"stale app revision for app {s.app_id}")
        if (
            app_revision_conflicted
            and not fc.recovery_class
            and action.kind not in {"check_recovery", "recovery_restart", "resume"}
        ):
            raise ConflictError(f"draft changed outside Builder for app {s.app_id}")
        if action.kind in _CLIENT_ONLY_ACTIONS:
            # Client-side-only actions (e.g. view_changes toggles a card locally) never
            # reach the engine — dispatching would hit handle_await_decision's keep_draft
            # default and silently terminate the session. Return the current view unchanged.
            return self._build_session_view(s, fc), False
        if action.kind == "update_model":
            if is_working(s.current_state) or self._session_lock.exists(session_id):
                raise BusyError(f"session {session_id} is busy")
            model_config = action.payload.get("model_config")
            if not isinstance(model_config, dict) or not model_config:
                raise BadRequestError("model_config is required")
            validate_model_config(actor.tenant_id, model_config)
            fc.model_config = model_config
            item = NoticeItem(text=f"Model changed to {model_config.get('name', '')}").to_item(
                seq=fc.next_seq,
                at_version=s.version + 1,
            )
            fc.next_seq += 1
            self._repo.compare_and_advance(session_id, s.version, s.current_state, fc, [item])
            return self.get_session_view(session_id, actor), False
        return self._build_session_view(s, fc), True

    def submit_action(self, session_id: str, actor: Actor, action: Action) -> SessionView:
        """Port of Go ``SubmitAction``."""
        view, expect_advance = self._prepare_action(session_id, actor, action)
        if expect_advance:
            self.dispatch(session_id, action, actor)
        return self.get_session_view(session_id, actor)

    def submit_message(
        self,
        session_id: str,
        actor: Actor,
        text: str,
        base_version: int,
        client_turn_id: str,
    ) -> SessionView:
        """Port of Go ``SubmitMessage``."""
        if not isinstance(text, str) or not (text := text.strip()):
            raise BadRequestError("message text is required")
        return self.submit_action(
            session_id,
            actor,
            Action(
                kind="message",
                payload={"text": text, "client_turn_id": client_turn_id},
                base_version=base_version,
            ),
        )

    def submit_action_stream(self, session_id: str, actor: Actor, action: Action) -> Iterator[str]:
        """Streaming counterpart of ``submit_action``: performs the same eager
        validation via ``_prepare_action`` (raising before any streaming begins),
        then -- for the dispatch case -- subscribes BEFORE enqueuing the advance
        so no progress frames are lost, and returns the frame generator."""
        from services.dify_builder.wiring import stream_advance_frames

        view, expect_advance = self._prepare_action(session_id, actor, action)
        if not expect_advance:
            # ``message`` (replay of a settled turn) and ``update_model`` both
            # settle synchronously while changing the version, so they must emit
            # a terminal ``state`` frame carrying the new version -- else a FE
            # tracking its held version off ``state`` frames stays stale and its
            # next action 409s.
            return stream_advance_frames(
                asdict(view),
                None,
                expect_advance=False,
                emit_state_when_settled=action.kind in {"message", "update_model"},
            )
        subscription = self._subscribe_fn(session_id)  # BEFORE dispatch
        try:
            self.dispatch(session_id, action, actor)
            view_dict = asdict(view)
        except Exception:
            if subscription is not None:
                subscription.close()
            raise
        return stream_advance_frames(view_dict, subscription, expect_advance=True)

    def submit_message_stream(
        self,
        session_id: str,
        actor: Actor,
        text: str,
        base_version: int,
        client_turn_id: str,
    ) -> Iterator[str]:
        if not isinstance(text, str) or not (text := text.strip()):
            raise BadRequestError("message text is required")
        return self.submit_action_stream(
            session_id,
            actor,
            Action(
                kind="message",
                payload={"text": text, "client_turn_id": client_turn_id},
                base_version=base_version,
            ),
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
