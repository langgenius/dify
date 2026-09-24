"""The Dify Builder usecase: session lifecycle + dispatch.

Port of dify-enterprise/server/pkg/enterprise/biz/dify_builder/usecase.go.

Dependency-injected (``repo``, ``session_lock``, ``enqueue_fn`` are
constructor args) so it stays unit-testable without importing the real
Redis-backed ``session_lock`` module or Celery -- those are wired in by the
caller (P3b Task 4: the Flask controller + the Celery task's ``.delay``).
"""

import json
from collections.abc import Callable, Iterator
from dataclasses import asdict
from enum import StrEnum
from typing import Protocol
from uuid import uuid4

from core.dify_builder import recovery
from core.dify_builder.contract import (
    CONFIRM_ACTION_ID,
    ActionKind,
    ActiveInteraction,
    AppRevision,
    CardOption,
    CheckpointRef,
    ConversationPage,
    Decision,
    InteractionResponseField,
    InteractionResponseItem,
    NoticeItem,
    OptionInput,
    Phase,
    PreflightContextCard,
    PreflightIssue,
    RunContextCard,
    RunStatus,
    SessionModel,
    SessionView,
    UserItem,
)
from core.dify_builder.contract import Action as UiAction
from core.dify_builder.errors import BadRequestError, BusyError, ConflictError, NotFoundError
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
from services.dify_builder.agent.model_resolver import validate_model_config

__all__ = [
    "AppAccess",
    "DifyBuilderService",
    "SessionLock",
    "SessionView",
    "resolve_action_kind",
    "resolve_submitted_action",
]


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
    PcState.BUILD_GOAL_ANALYSIS: [
        UiAction(
            id="submit_requirements",
            label="Submit requirements",
            kind=ActionKind.PRIMARY,
            next_state="build.resource_recommendation",
        ),
    ],
    # build.initial_plan offers no UI action: it is a working/pass-through
    # state now (state.py), not a waiting one -- the straight-through path no
    # longer stops there (submit_requirements now goes directly to resource
    # discovery -- see handlers_build.handle_goal_analysis), and the
    # continue_adjusting/retry_after_revert loop-back that still lands there
    # runs its handler unconditionally on entry, with no action to gate on.
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
        UiAction(id="approve_plan", label="Apply the fix", kind=ActionKind.PRIMARY, next_state="build.execution"),
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
    # Edit (Slice 3). next_state/canvas_event carry the frozen state-map hints.
    PcState.EDIT_CAPABILITY_CHECK: [
        UiAction(id="send_edit_goal", label="Send", kind=ActionKind.PRIMARY, next_state="edit.impact_analysis"),
    ],
    PcState.EDIT_IMPACT_ANALYSIS: [
        UiAction(
            id="submit_edit_rules", label="Submit rules", kind=ActionKind.PRIMARY, next_state="edit.plan_approval"
        ),
    ],
    # Approve is NOT the only exit: an approval the engine refuses leaves the
    # user parked here with the plan unchanged, so the gate also offers a way
    # back to the rules and a way out entirely (triage
    # edit-branch-failure-2026-09-22, "Hard dead end").
    PcState.EDIT_PLAN_APPROVAL: [
        UiAction(
            id="approve_plan",
            label="Approve changes",
            kind=ActionKind.PRIMARY,
            next_state="edit.apply_changes",
            canvas_event="create_checkpoint",
        ),
        UiAction(
            id="continue_adjusting",
            label="Continue adjusting",
            kind=ActionKind.SECONDARY,
            next_state="edit.impact_analysis",
        ),
        # Same ``revert`` id and the same perform_revert path as every other
        # gate, but labelled for what it does HERE: nothing has been applied
        # yet, so this discards the proposal rather than undoing an edit the
        # user can see on the canvas.
        UiAction(
            id="revert",
            label="Discard this change plan",
            kind=ActionKind.DESTRUCTIVE,
            next_state="edit.reverted",
            canvas_event="revert_checkpoint",
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
        UiAction(id="approve_plan", label="Apply the fix", kind=ActionKind.PRIMARY, next_state="edit.apply_changes"),
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
    if interrupted:
        # Crash mid auto-advance (lock released, nothing durably failed): Retry
        # re-runs the interrupted working handler in place; Start over resets and
        # re-enters the flow's entry state from the current draft.
        return [
            UiAction(id="recovery_continue", label="Retry", kind=ActionKind.PRIMARY),
            UiAction(id="restart", label="Restart from current draft", kind=ActionKind.SECONDARY),
        ]
    if state == PcState.FAILED:
        # A durable, deterministic failure -- re-running the same handler would
        # just fail again, so only offer a restart from the current draft.
        return [UiAction(id="restart", label="Restart from current draft", kind=ActionKind.PRIMARY)]
    if fc is not None and fc.paused:
        return []
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

    return list(_ACTIONS_FOR.get(state, []))


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


# Options that need a sentence from the user to be an answer at all. Builder
# replans from the rejection text, so a bare "no" is not something it can act on.
_OPTION_INPUTS: dict[str, OptionInput] = {
    "reject_repair": OptionInput(
        placeholder="Explain the rejection -- Builder replans from it",
        min_length=10,
        max_length=200,
        required=True,
    ),
}


_DECISION_COPY_FOR: dict[PcState, tuple[str, str]] = {
    PcState.FIX_AWAIT_APPROVAL: ("How should Builder proceed with this fix?", "Choose one option to continue."),
    PcState.FIX_AWAIT_VERIFY: ("What should Builder do with the applied fix?", "Choose one option to continue."),
    PcState.FIX_AWAIT_DECISION: ("What should happen to this fix?", "Choose one option to continue."),
    PcState.CHECKLIST_AWAIT_RECHECK: ("What should Builder do next?", "Choose one option to continue."),
    PcState.BUILD_PLAN_APPROVAL: ("Is this workflow plan ready to apply?", "Choose one option to continue."),
    PcState.BUILD_EXECUTION: ("What should Builder do with the built workflow?", "Choose one option to continue."),
    PcState.BUILD_AWAIT_REPAIR: ("What should Builder do with the proposed repair?", "Choose one option to continue."),
    PcState.BUILD_REVIEW: ("What should happen to this workflow?", "Choose one option to continue."),
    PcState.BUILD_REVERTED: ("How should Builder continue after the revert?", "Choose one option to continue."),
    PcState.EDIT_PLAN_APPROVAL: ("Is this change plan ready to apply?", "Choose one option to continue."),
    PcState.EDIT_APPLY_CHANGES: ("What should Builder do with the updated workflow?", "Choose one option to continue."),
    PcState.EDIT_AWAIT_REPAIR: ("What should Builder do with the proposed repair?", "Choose one option to continue."),
    PcState.EDIT_REVIEW: ("What should happen to these changes?", "Choose one option to continue."),
    PcState.EDIT_REVERTED: ("How should Builder continue after the revert?", "Choose one option to continue."),
    PcState.FAILED: ("How should Builder recover?", "Choose one option to continue."),
}


def _decision_for(state: PcState, actions: list[UiAction]) -> Decision | None:
    """Project a non-form gate as one blocking choice interaction."""
    renderable = [a for a in actions if a.kind != ActionKind.AUTOMATIC]
    if not renderable or any(action.id in _ACTIVE_INTERACTION_CARD_FOR_ACTION for action in renderable):
        return None
    # Only the first primary is badged: two recommendations is no recommendation.
    default_index = next((i for i, a in enumerate(renderable) if a.kind == ActionKind.PRIMARY), -1)
    options = [
        CardOption(
            id=a.id,
            label=a.label,
            is_default=(i == default_index),
            tone="destructive" if a.kind == ActionKind.DESTRUCTIVE else "neutral",
            input=_OPTION_INPUTS.get(a.id),
            next_state=a.next_state,
            canvas_event=a.canvas_event,
        )
        for i, a in enumerate(renderable)
    ]
    title, description = _DECISION_COPY_FOR.get(
        state,
        ("How should Builder continue?", "Choose one option to continue."),
    )
    return Decision(
        title=title,
        description=description,
        options=options,
        submit=UiAction(id=CONFIRM_ACTION_ID, label="Submit", kind=ActionKind.PRIMARY),
        default_option_id=options[default_index].id if default_index >= 0 else "",
    )


_ACTIVE_INTERACTION_CARD_FOR_ACTION: dict[str, tuple[str, str | None]] = {
    "submit_requirements": ("form", "build_requirements"),
    "submit_edit_rules": ("form", "edit_rules"),
    "provide_testdata": ("form", "testdata"),
    "confirm_resources": ("resource_select", None),
}

_FORM_COPY_FOR_VARIANT: dict[str, tuple[str, str]] = {
    "build_requirements": (
        "Review the requirements",
        "Adjust any values before Builder continues.",
    ),
    "edit_rules": (
        "Review the change rules",
        "Adjust any values before Builder applies the change plan.",
    ),
    "testdata": (
        "Provide test data",
        "Review the inputs Builder will use for this run.",
    ),
}


def _display_interaction_value(value: object) -> str:
    if value is None or value == "":
        return "—"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, list):
        return ", ".join(_display_interaction_value(item) for item in value) or "—"
    if isinstance(value, dict):
        name = value.get("name") or value.get("filename")
        if isinstance(name, str) and name:
            return name
        return json.dumps(value, ensure_ascii=False, default=str, separators=(",", ":"))
    return str(value)


def _selected_ui_action(actions: list[UiAction], action: Action) -> UiAction | None:
    option_id = action.payload.get("option_id")
    if isinstance(option_id, str) and option_id:
        selected = next((candidate for candidate in actions if candidate.id == option_id), None)
        if selected is not None:
            return selected
    matching = [candidate for candidate in actions if resolve_action_kind(candidate.id) == action.kind]
    return matching[0] if len(matching) == 1 else None


def _interaction_response_for(
    repo: Repository,
    session: Session,
    action: Action,
    visible_actions: list[UiAction],
) -> InteractionResponseItem | None:
    selected_action = _selected_ui_action(visible_actions, action)
    if selected_action is None:
        return None

    card_contract = _ACTIVE_INTERACTION_CARD_FOR_ACTION.get(selected_action.id)
    if card_contract is None:
        free_text = action.payload.get("free_text")
        option_input = _OPTION_INPUTS.get(selected_action.id)
        submitted_data: dict[str, object] = {"option_id": selected_action.id}
        answer = selected_action.label
        if option_input is not None and isinstance(free_text, str) and free_text.strip():
            normalized_free_text = free_text.strip()
            submitted_data["free_text"] = normalized_free_text
            answer = f"{answer} — {normalized_free_text}"
        title, _description = _DECISION_COPY_FOR.get(
            session.current_state,
            ("How should Builder continue?", ""),
        )
        return InteractionResponseItem(
            interaction_kind="choice",
            question=title,
            answer=answer,
            submitted_data=submitted_data,
        )

    card_kind, expected_variant = card_contract
    card = repo.get_latest_conversation_item(session.id, frozenset({card_kind}))
    if card is None:
        return None

    if card_kind == "resource_select":
        raw_ids = action.payload.get("resource_ids")
        selected_ids = [value for value in raw_ids if isinstance(value, str)] if isinstance(raw_ids, list) else []
        resources = card.payload.get("recommended")
        resource_options = resources if isinstance(resources, list) else []
        selected_labels = [
            str(resource.get("label") or resource.get("id") or "")
            for resource in resource_options
            if isinstance(resource, dict) and resource.get("id") in selected_ids
        ]
        return InteractionResponseItem(
            interaction_kind="resource",
            question=str(card.payload.get("title") or "Which resources should Builder use?"),
            answer=", ".join(label for label in selected_labels if label) or "No resources selected",
            submitted_data={"resource_ids": selected_ids},
        )

    variant = str(card.payload.get("variant") or "")
    if expected_variant is not None and variant != expected_variant:
        return None
    raw_values = action.payload.get("inputs") if selected_action.id == "provide_testdata" else action.payload
    submitted_values = raw_values if isinstance(raw_values, dict) else {}
    raw_fields = card.payload.get("fields")
    fields = raw_fields if isinstance(raw_fields, list) else []
    response_fields: list[InteractionResponseField] = []
    normalized_values: dict[str, object] = {}
    for raw_field in fields:
        if not isinstance(raw_field, dict):
            continue
        key = raw_field.get("key")
        if not isinstance(key, str) or not key:
            continue
        value = submitted_values.get(key)
        normalized_values[key] = value
        response_fields.append(
            InteractionResponseField(
                key=key,
                label=str(raw_field.get("label") or key),
                value=value,
                display_value=_display_interaction_value(value),
            )
        )
    fallback_title, _fallback_description = _FORM_COPY_FOR_VARIANT.get(
        variant,
        ("Submitted form", ""),
    )
    return InteractionResponseItem(
        interaction_kind="form",
        question=str(card.payload.get("title") or fallback_title),
        fields=response_fields,
        submitted_data=normalized_values,
    )


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
    PcState.BUILD_GOAL_ANALYSIS: frozenset({"submit_requirements"}),
    # BUILD_INITIAL_PLAN is a working/pass-through state now (state.py) -- it
    # no longer gates on any action, so it has no entry here, matching every
    # other working Build/Edit state (BUILD_TEST_AND_REPAIR, BUILD_PUBLISH, ...).
    PcState.BUILD_RESOURCE_RECOMMENDATION: frozenset({"confirm_resources"}),
    PcState.BUILD_PLAN_APPROVAL: frozenset({"approve_repair"}),
    PcState.BUILD_EXECUTION: frozenset({"run_test", "undo"}),
    PcState.BUILD_AWAIT_TESTDATA: frozenset({"provide_testdata"}),
    PcState.BUILD_AWAIT_REPAIR: frozenset({"approve_repair", "keep_draft", "undo"}),
    PcState.BUILD_REVIEW: frozenset({"publish_workflow", "keep_draft", "re_fix", "undo"}),
    PcState.BUILD_REVERTED: frozenset({"re_fix"}),
    PcState.EDIT_CAPABILITY_CHECK: frozenset({"send_edit_goal"}),
    PcState.EDIT_IMPACT_ANALYSIS: frozenset({"submit_edit_rules"}),
    PcState.EDIT_PLAN_APPROVAL: frozenset({"approve_repair", "re_fix", "undo"}),
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

# Working states whose interrupted-step Retry (recovery_continue) re-runs a
# privileged op: publish (RELEASE) or a draft test run (TEST_AND_RUN). A Retry
# re-invokes the state's handler, so it must be gated at that op's tier, not the
# base EDIT the recovery actions otherwise carry.
_PUBLISH_WORKING_STATES = frozenset({PcState.BUILD_PUBLISH, PcState.FIX_PUBLISH, PcState.EDIT_PUBLISH})
_TEST_WORKING_STATES = frozenset({PcState.BUILD_TEST_AND_REPAIR, PcState.FIX_VERIFY, PcState.EDIT_TEST_AFFECTED_PATHS})


def _app_access_for_action(state: PcState, kind: str) -> AppAccess:
    if kind in _RELEASE_ACTIONS:
        return AppAccess.RELEASE
    if kind in _TEST_AND_RUN_ACTIONS or (kind == "approve_repair" and state in _REPAIR_THEN_RETEST_STATES):
        return AppAccess.TEST_AND_RUN
    # A recovery_continue (Retry) re-runs the interrupted working handler, which
    # re-invokes the state's privileged op -- enforce that op's tier, not base EDIT.
    # (recovery_restart only resets + re-enters the entry state, so it stays EDIT.)
    if kind == "recovery_continue":
        if state in _PUBLISH_WORKING_STATES:
            return AppAccess.RELEASE
        if state in _TEST_WORKING_STATES:
            return AppAccess.TEST_AND_RUN
    return AppAccess.EDIT


def _internal_action_allowed(state: PcState, fc: DifyBuilderContext, kind: str) -> bool:
    """Validate runner/service short-circuits against their product state.

    These commands do not appear in ``_ACTIONS_FOR``, but they are not global:
    transcript/model commands operate only at a waiting gate, pause transitions
    must change the current pause flag, and recovery choices must match the
    current terminal/interrupted/drift-recovery condition.
    """
    if state == PcState.FAILED:
        # Durable, deterministic failure -- only a restart is meaningful.
        return kind == "recovery_restart"
    # An interrupted working step may be retried or restarted. A live worker is
    # still protected downstream by dispatch's advance-lock acquisition.
    if is_working(state):
        return kind in {"recovery_continue", "recovery_restart"}
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
    """
    return _ACTION_ID_TO_KIND.get(raw, raw)


def resolve_submitted_action(action_id: str, payload: dict | None) -> str:
    """Map what the client posted to the engine handler kind.

    The interaction dock posts ``confirm`` and names its choice in
    ``payload["option_id"]``. Handler-facing callers may already use the
    resolved action id. A ``confirm`` naming no option resolves to "", which
    the per-state legality check then rejects.
    """
    if action_id == CONFIRM_ACTION_ID:
        action_id = str(payload.get("option_id") or "") if isinstance(payload, dict) else ""
    return resolve_action_kind(action_id)


_WAITING_INPUT_STATES = frozenset(
    {
        PcState.FIX_AWAIT_TESTDATA,
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
    through to PROCESSING.

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
        return RunStatus.PROCESSING
    return RunStatus.PROCESSING  # defensive; unreachable for classified states


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
        get_app_name_fn: Callable[[str, Actor], str] | None = None,
    ) -> None:
        self._repo = repo
        self._session_lock = session_lock
        self._enqueue_fn = enqueue_fn
        self._subscribe_fn = subscribe_fn or (lambda _sid: None)
        self._authorize_app_fn = authorize_app_fn or (lambda _actor, _app_id, _access: None)
        self._get_app_revision_fn = get_app_revision_fn or (lambda _app_id, _actor: "")
        self._get_app_name_fn = get_app_name_fn or (lambda _app_id, _actor: "")

    def _get_app_revision(self, app_id: str, actor: Actor) -> str:
        revision = self._get_app_revision_fn(app_id, actor)
        return revision if isinstance(revision, str) else ""

    def _get_app_name(self, app_id: str, actor: Actor) -> str:
        name = self._get_app_name_fn(app_id, actor)
        return name if isinstance(name, str) else ""

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
    def _validate_model_config(actor: Actor, model_config: dict | None) -> dict:
        if model_config is not None and not isinstance(model_config, dict):
            raise BadRequestError("model_config must be an object")
        return validate_model_config(actor.tenant_id, model_config)

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
        app_id = self._authorize_app(app_id, actor)
        model_config = self._validate_model_config(actor, model_config)
        app_revision = self._get_app_revision(app_id, actor)
        failed_run: Run | None = None
        if checklist_errors:
            entry_mode, state = EntryMode.FIX_CHECKLIST, PcState.CHECKLIST_DIAGNOSE
            fc = DifyBuilderContext(
                source="checklist",
                checklist_errors=checklist_errors,
                model_config=model_config,
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
                model_config=model_config,
                last_snapshot_hash=app_revision,
            )

        s = Session(
            app_id=app_id,
            tenant_id=actor.tenant_id,
            owner_account_id=actor.account_id,
            entry_mode=entry_mode,
            current_state=state,
        )
        if checklist_errors:
            issues = [
                PreflightIssue(
                    node_id=issue.node_id,
                    node_type=issue.node_type,
                    title=issue.title,
                    messages=list(issue.messages),
                    unconnected=issue.unconnected,
                    plugin_missing=issue.plugin_missing,
                )
                for issue in checklist_errors
            ]
            context_card = PreflightContextCard(
                node_count=len({issue.node_id for issue in checklist_errors if issue.node_id}),
                issue_count=len(checklist_errors),
                issues=issues,
            )
        else:
            context_card = RunContextCard(
                run_id=failed_run_id or "",
                title="",
                error_code="",
                message="",
                trace_ref="",
            )
        items = [context_card.to_item(seq=0, at_version=0)]
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
        initial_items = self._repo.list_conversation(session_id)
        subscription = self._subscribe_fn(session_id)  # BEFORE dispatch
        try:
            command_id = self.dispatch(session_id, action, actor)
            view_dict = asdict(self.get_session_view(session_id, actor))
        except Exception:
            if subscription is not None:
                subscription.close()
            raise
        return stream_advance_frames(
            view_dict,
            subscription,
            expect_advance=True,
            command_id=command_id,
            initial_items=initial_items,
        )

    def _prepare_build_session(
        self,
        app_id: str,
        actor: Actor,
        goal_text: str,
        model_config: dict | None = None,
        derive_app_name: bool = False,
    ) -> tuple[str, Action]:
        """Shared setup for ``create_build_session``/``create_build_session_stream``:
        everything through persisting the session up to -- but not including --
        the internal ``start_build`` dispatch."""
        if not isinstance(goal_text, str) or not (goal_text := goal_text.strip()):
            raise BadRequestError("goal_text is required")
        app_id = self._authorize_app(app_id, actor)
        model_config = self._validate_model_config(actor, model_config)
        app_revision = self._get_app_revision(app_id, actor)
        fc = DifyBuilderContext(
            goal_text=goal_text,
            model_config=model_config,
            last_snapshot_hash=app_revision,
            app_name=self._get_app_name(app_id, actor),
            app_name_auto=derive_app_name,
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
            kind="start_build",
            base_version=1,
            base_app_revision=app_revision,
        )

    def create_build_session(
        self,
        app_id: str,
        actor: Actor,
        goal_text: str,
        model_config: dict | None = None,
        derive_app_name: bool = False,
    ) -> SessionView:
        """Start a Build session at build.capability_check and dispatch the
        initial ``start_build`` command (parallels ``create_fix_session``). The goal is
        seeded as the user's opening bubble; the first advance's
        ``handle_capability_check`` analyzes it into requirements."""
        session_id, action = self._prepare_build_session(app_id, actor, goal_text, model_config, derive_app_name)
        if action is not None:
            self.dispatch(session_id, action, actor)
        return self.get_session_view(session_id, actor)

    def create_build_session_stream(
        self,
        app_id: str,
        actor: Actor,
        goal_text: str,
        model_config: dict | None = None,
        derive_app_name: bool = False,
    ) -> Iterator[str]:
        """Streaming counterpart of ``create_build_session``: subscribes BEFORE
        dispatching the initial ``start_build`` advance."""
        from services.dify_builder.wiring import stream_advance_frames

        session_id, action = self._prepare_build_session(app_id, actor, goal_text, model_config, derive_app_name)
        initial_items = self._repo.list_conversation(session_id)
        subscription = self._subscribe_fn(session_id)  # BEFORE dispatch
        try:
            command_id = self.dispatch(session_id, action, actor)
            view_dict = asdict(self.get_session_view(session_id, actor))
        except Exception:
            if subscription is not None:
                subscription.close()
            raise
        return stream_advance_frames(
            view_dict,
            subscription,
            expect_advance=True,
            command_id=command_id,
            initial_items=initial_items,
        )

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
        app_id = self._authorize_app(app_id, actor)
        model_config = self._validate_model_config(actor, model_config)
        app_revision = self._get_app_revision(app_id, actor)
        fc = DifyBuilderContext(
            goal_text=goal_text,
            model_config=model_config,
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
        initial_items = self._repo.list_conversation(session_id)
        subscription = self._subscribe_fn(session_id)  # BEFORE dispatch
        try:
            command_id = self.dispatch(session_id, action, actor)
            view_dict = asdict(self.get_session_view(session_id, actor))
        except Exception:
            if subscription is not None:
                subscription.close()
            raise
        return stream_advance_frames(
            view_dict,
            subscription,
            expect_advance=True,
            command_id=command_id,
            initial_items=initial_items,
        )

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
        # The interrupted-step offer (Retry / Start over) is projected as concrete
        # actions by ``_actions_for(interrupted=...)`` above. The ``recovery`` field
        # carries only the drift-recovery class set at a waiting gate.
        recovery_ref = recovery.recovery_ref_for(fc.recovery_class)
        return SessionView(
            session_id=s.id,
            app_id=s.app_id,
            version=s.version,
            state=str(st),
            canvas_read_only=lock_held or canvas_read_only(st),
            run_status=RunStatus.PROCESSING if lock_held else _run_status(st, paused=fc.paused),
            interrupted=interrupted,
            conversation_last_seq=fc.next_seq - 1,
            entry_mode=s.entry_mode,
            phase=_phase_for(st),
            actions=actions,
            decision=_decision_for(st, actions),
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
            last_command_id=fc.last_command_id,
        )

    def _prepare_action(
        self, session_id: str, actor: Actor, action: Action
    ) -> tuple[SessionView, bool, list[ConversationItem]]:
        """Shared synchronous validation + settle for ``submit_action`` and the
        streaming submit methods. Returns ``(view, expect_advance, items)``:
        ``expect_advance`` is ``True`` only when the caller must still call
        ``dispatch``; ``items`` contains rows committed synchronously before a
        worker is needed. This method never dispatches itself, so a streaming
        caller can subscribe before the advance is enqueued."""
        action.command_id = action.command_id or str(uuid4())
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
                return self._build_session_view(s, fc), False, []
            if "user" in turn_kinds:
                action.base_version = s.version
        lifecycle_limited = bool(
            fc.paused or fc.recovery_class or is_working(s.current_state) or is_terminal(s.current_state)
        )
        internal_allowed = _internal_action_allowed(s.current_state, fc, action.kind)
        if not internal_allowed and (
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
        # A testdata submit carries run inputs, never graph edits, so neither
        # revision gate below applies: a draft that moved while the user was
        # typing changes nothing about the values they typed. This gate is also
        # the one place a human types for tens of seconds -- long enough for the
        # editor's own autosave to land right after Builder wrote the canvas,
        # which used to refuse the submit and leave the form frozen behind a
        # recovery prompt.
        revision_exempt = action.kind == "provide_testdata"
        if not revision_exempt and action.kind not in {"message", "update_model"}:
            if current_app_revision and not action.base_app_revision:
                raise BadRequestError("base_app_revision is required")
            if action.base_app_revision and action.base_app_revision != current_app_revision:
                raise ConflictError(f"stale app revision for app {s.app_id}")
        if (
            app_revision_conflicted
            and not fc.recovery_class
            and not revision_exempt
            and action.kind not in {"check_recovery", "recovery_restart", "resume"}
        ):
            raise ConflictError(f"draft changed outside Builder for app {s.app_id}")
        visible_actions = _actions_for(
            s.current_state,
            fc,
            interrupted=is_working(s.current_state) and not self._session_lock.exists(session_id),
            app_revision_conflicted=app_revision_conflicted,
        )
        interaction_response = _interaction_response_for(self._repo, s, action, visible_actions)
        action.interaction_response = asdict(interaction_response) if interaction_response is not None else None
        if action.kind == "update_model":
            if is_working(s.current_state) or self._session_lock.exists(session_id):
                raise BusyError(f"session {session_id} is busy")
            model_config = action.payload.get("model_config")
            if not isinstance(model_config, dict) or not model_config:
                raise BadRequestError("model_config is required")
            fc.model_config = validate_model_config(actor.tenant_id, model_config)
            item = NoticeItem(text=f"Model changed to {model_config.get('name', '')}").to_item(
                seq=fc.next_seq,
                at_version=s.version + 1,
            )
            fc.next_seq += 1
            fc.last_command_id = action.command_id
            items = [item]
            # This notice is committed directly (not via Runner._commit), so the
            # engine's reply-language localization hook never sees it. Localize it
            # here so it matches the session's detected language like every other
            # card. No-op when reply_language is unset (English fallback).
            if fc.reply_language:
                from services.dify_builder.agent.llm_agent import LlmBuilderAgent
                from services.dify_builder.agent.localize import Localizer

                localizer = Localizer(LlmBuilderAgent(actor.tenant_id, fc.model_config).model_or_none)
                items = localizer.localize_items(items, fc.reply_language)
            self._repo.compare_and_advance(session_id, s.version, s.current_state, fc, items)
            return self.get_session_view(session_id, actor), False, items
        return self._build_session_view(s, fc), True, []

    def submit_action(self, session_id: str, actor: Actor, action: Action) -> SessionView:
        """Port of Go ``SubmitAction``."""
        view, expect_advance, _settled_items = self._prepare_action(session_id, actor, action)
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
        so no progress frames are lost. Synchronously committed items are sent
        individually before the terminal projection."""
        from services.dify_builder.wiring import stream_advance_frames

        view, expect_advance, settled_items = self._prepare_action(session_id, actor, action)
        if not expect_advance:
            # ``message`` (replay of a settled turn) and ``update_model`` both
            # settle synchronously while changing the version, so they must emit
            # a terminal ``command_finished`` frame carrying the new version --
            # otherwise a client keeps a stale held version and its next action
            # conflicts.
            return stream_advance_frames(
                asdict(view),
                None,
                expect_advance=False,
                emit_command_finished_when_settled=action.kind in {"message", "update_model"},
                command_id=action.command_id,
                initial_items=settled_items,
            )
        subscription = self._subscribe_fn(session_id)  # BEFORE dispatch
        try:
            command_id = self.dispatch(session_id, action, actor)
            view_dict = asdict(view)
        except Exception:
            if subscription is not None:
                subscription.close()
            raise
        return stream_advance_frames(view_dict, subscription, expect_advance=True, command_id=command_id)

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

    def dispatch(self, session_id: str, action: Action, actor: Actor) -> str:
        """Port of Go ``dispatch``: acquire-or-busy + enqueue, release on
        enqueue failure."""
        action.command_id = action.command_id or str(uuid4())
        token = self._session_lock.acquire(session_id)
        if token is None:
            raise BusyError(f"session {session_id} is busy")
        try:
            self._enqueue_fn(session_id, action, actor, token)
        except Exception:
            self._session_lock.release(session_id, token)
            raise
        return action.command_id
