"""Workflow Copilot FE<->backend interaction contract.

New for the Build/Edit slice (spec: ``docs/superpowers/specs/
2026-08-21-workflow-copilot-full-flow-contract-design.md``, §2 enums, §6
canvas events, §7 state machines). These enums freeze the wire vocabulary
shared by all entry modes (Fix, Build, Edit) — canned agent today, a future
ProAgent tomorrow, same shapes (§ Global Constraints: "canned-agnostic").

All members are ``StrEnum`` so ``dataclasses.asdict``/``json.dumps`` emit the
snake_case wire value directly; the member name is just the UPPER_SNAKE of
that value.
"""

from dataclasses import dataclass
from enum import StrEnum


class Phase(StrEnum):
    """Coarse UX phase shown in the panel header (spec §2)."""

    UNDERSTAND = "understand"
    CLARIFY = "clarify"
    RESOURCES = "resources"
    PLAN = "plan"
    MODIFY = "modify"
    TEST = "test"
    REVIEW = "review"
    PUBLISH = "publish"
    COMPLETE = "complete"


class RunStatus(StrEnum):
    """Widened run-status vocabulary (spec §2).

    ``thinking``/``executing`` => ``canvas_read_only = true`` (WORKING).
    ``waiting_*``/``paused`` => editable (WAITING).
    ``complete``/``failed`` => terminal.
    """

    THINKING = "thinking"
    EXECUTING = "executing"
    WAITING_INPUT = "waiting_input"
    WAITING_CONFIRMATION = "waiting_confirmation"
    PAUSED = "paused"
    FAILED = "failed"
    COMPLETE = "complete"


class ActionKind(StrEnum):
    """Action button styling / semantics (spec §2, §5).

    ``automatic`` actions are not buttons — the client must not render
    them; the server auto-advances. They exist in the stream only so the
    FE can show "auto-continuing...".
    """

    PRIMARY = "primary"
    SECONDARY = "secondary"
    DESTRUCTIVE = "destructive"
    AUTOMATIC = "automatic"


class CardKind(StrEnum):
    """The conversation-item/card vocabulary (spec §4)."""

    USER = "user"
    DECISION = "decision"
    NOTICE = "notice"
    RUN_CONTEXT = "run_context"
    PREFLIGHT_CONTEXT = "preflight_context"
    ASSISTANT_TURN = "assistant_turn"
    PLAN = "plan"
    FORM = "form"
    CHALLENGE = "challenge"
    RESOURCE_SELECT = "resource_select"
    CHECKPOINT = "checkpoint"
    CHANGE_SET = "change_set"
    TEST_RESULT = "test_result"
    ERROR = "error"
    SUMMARY = "summary"
    PUBLISH = "publish"
    BUILD_LEARNING = "build_learning"


class CanvasEvent(StrEnum):
    """Granular canvas-mutation signals (spec §6).

    Exactly 22 members, snake_cased from the mock's ``CopilotCanvasEvent``
    union. Presentation of committed backend state: replaying these from a
    snapshot must reconstruct the same canvas.
    """

    RESET_BUILD_CANVAS = "reset_build_canvas"
    ADD_START_NODE = "add_start_node"
    ADD_KNOWLEDGE_NODE = "add_knowledge_node"
    ADD_LLM_NODE = "add_llm_node"
    ADD_OUTPUT_NODE = "add_output_node"
    FOCUS_WORKFLOW = "focus_workflow"
    HIGHLIGHT_EDIT_TARGET = "highlight_edit_target"
    APPLY_EDIT_PLAN = "apply_edit_plan"
    START_TEST_RUN = "start_test_run"
    MARK_TEST_ERROR = "mark_test_error"
    FOCUS_ERROR_NODE = "focus_error_node"
    FOCUS_CHECKLIST_NODE = "focus_checklist_node"
    CREATE_CHECKPOINT = "create_checkpoint"
    APPLY_ERROR_FIX = "apply_error_fix"
    MARK_REPAIR_APPLIED = "mark_repair_applied"
    APPLY_PREFLIGHT_FIX = "apply_preflight_fix"
    START_RETEST = "start_retest"
    MARK_TEST_SUCCESS = "mark_test_success"
    MARK_REVIEW_READY = "mark_review_ready"
    REVERT_CHECKPOINT = "revert_checkpoint"
    CANCEL_PUBLISH = "cancel_publish"
    PUBLISH_WORKFLOW = "publish_workflow"


class ConflictPolicy(StrEnum):
    """Resource-conflict handling in Build (spec §2)."""

    AUDITED = "audited"
    ASK = "ask"


class SkillLearningPolicy(StrEnum):
    """Governance tail (spec §2). Deferred — contract-only for now."""

    ASK = "ask"
    AUTOMATIC = "automatic"
    DISABLED = "disabled"


@dataclass
class Action:
    """A UI action the FE renders (spec §5).

    DISTINCT from ``core.workflow_copilot.models.Action`` (the submit DTO
    the FE POSTs back) -- this one is what the server *sends* describing a
    renderable button.
    """

    id: str
    label: str
    kind: ActionKind
    next_state: str | None = None
    canvas_event: str | None = None


@dataclass
class CheckpointRef:
    """Active restore point on the SessionView (spec §8)."""

    checkpoint_id: str
    label: str
    created_at: str
