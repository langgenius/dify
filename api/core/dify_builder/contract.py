"""Dify Builder FE<->backend interaction contract.

New for the Build/Edit slice (spec: ``docs/superpowers/specs/
2026-08-21-dify-builder-full-flow-contract-design.md``, §2 enums, §6
canvas events, §7 state machines). These enums freeze the wire vocabulary
shared by all entry modes (Fix, Build, Edit) — canned agent today, a future
ProAgent tomorrow, same shapes (§ Global Constraints: "canned-agnostic").

All members are ``StrEnum`` so ``dataclasses.asdict``/``json.dumps`` emit the
snake_case wire value directly; the member name is just the UPPER_SNAKE of
that value.
"""

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any, ClassVar

from core.dify_builder.models import ConversationItem


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

    Exactly 22 members, snake_cased from the mock's ``DifyBuilderCanvasEvent``
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


class RecoveryClass(StrEnum):
    """How the draft drifted from what the dify_builder last knew, when a session
    is reopened after a hand-edit (spec §8 / C-1)."""

    UNCHANGED = "unchanged"
    CONFIG_ONLY = "config_only"
    STRUCTURAL_COMPATIBLE = "structural_compatible"
    STRUCTURAL_INVALIDATING = "structural_invalidating"


@dataclass
class Action:
    """A UI action the FE renders (spec §5).

    DISTINCT from ``core.dify_builder.models.Action`` (the submit DTO
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


@dataclass
class RecoveryRef:
    """Draft-drift recovery offer on the SessionView (spec §8 / C-1)."""

    recovery_class: str
    can_continue: bool
    can_restart: bool
    message: str


# ---------------------------------------------------------------------------
# Card sub-types (spec §4.3). Plain dataclasses -- no ``kind`` discriminant,
# they nest inside a card's fields rather than standing alone in the
# conversation.
# ---------------------------------------------------------------------------


@dataclass
class FormField:
    """One field of a ``form`` card. ``type`` in text|textarea|select|bool."""

    key: str
    label: str
    type: str
    options: list[str] = field(default_factory=list)


@dataclass
class ResourceOption:
    """One recommended resource in a ``resource_select`` card.

    ``kind`` in knowledge|plugin|model|credential; ``readiness`` in
    ready|missing_config|missing_plugin|placeholder|waiting_setup.
    Credentials are referenced by name only -- never a secret.
    """

    id: str
    label: str
    meta: str
    kind: str
    readiness: str


@dataclass
class SessionModel:
    """The LLM chosen for this session, echoed for the FE model picker.

    Empty on the wire (``model: null``) means the session uses the tenant default.
    """

    provider: str
    name: str
    mode: str = ""
    completion_params: dict[str, Any] = field(default_factory=dict)


@dataclass
class ConflictPolicyOption:
    """One selectable conflict-resolution policy in a ``resource_select`` card."""

    id: str
    label: str
    recommended: bool = False


@dataclass
class PreflightIssue:
    """One checklist finding in a ``preflight_context`` card.

    ``kind`` in connection|variable|required_config|availability.
    """

    node_id: str
    label: str
    kind: str


@dataclass
class TraceStep:
    """One step of an ``assistant_turn``'s trace (spec §4.2).

    ``state`` in pending|active|done|stopped; ``tone`` in
    neutral|success|error; ``canvas_event`` fires as the step activates.
    """

    id: str
    label: str
    state: str
    tone: str = "neutral"
    canvas_event: str | None = None


@dataclass
class Trace:
    """The streamable trace nested in an ``assistant_turn`` (spec §4.2).

    ``status`` in running|completed|error|stopped.
    """

    status: str
    steps: list[TraceStep] = field(default_factory=list)


@dataclass
class TestStat:
    """One stat tile in a ``test_result`` card."""

    # Not a pytest test class; ``__test__`` (unannotated, so not a dataclass
    # field) tells pytest's Test*-name collector to skip it.
    __test__ = False

    value: str
    label: str


@dataclass
class SummaryRow:
    """One row of a ``completion``-variant ``summary`` card."""

    label: str
    value: str


# ---------------------------------------------------------------------------
# Cards (spec §4.3). Each subclasses ``_Card``: ``kind`` is a ``ClassVar``
# discriminant (not a dataclass field), so ``dataclasses.asdict(card)`` is
# exactly the card's wire ``payload`` -- no redundant ``kind`` inside it.
# ``to_item`` wraps the payload into the shipped ``ConversationItem``
# envelope (§4.1): ``{seq, kind, payload, at_version}``.
# ---------------------------------------------------------------------------


@dataclass
class _Card:
    kind: ClassVar[CardKind]

    def to_item(self, seq: int, at_version: int) -> ConversationItem:
        return ConversationItem(seq=seq, kind=str(self.kind), payload=asdict(self), at_version=at_version)


@dataclass
class UserItem(_Card):
    """Right-aligned bubble: raw user text."""

    kind: ClassVar[CardKind] = CardKind.USER

    text: str


@dataclass
class DecisionItem(_Card):
    """Right-aligned bubble: a committed-choice summary."""

    kind: ClassVar[CardKind] = CardKind.DECISION

    text: str


@dataclass
class NoticeItem(_Card):
    """A neutral/informational system notice."""

    kind: ClassVar[CardKind] = CardKind.NOTICE

    text: str
    tone: str = "neutral"


@dataclass
class RunContextCard(_Card):
    """Fix-run injected context (spec §4.3). ``trace_ref`` is redacted."""

    kind: ClassVar[CardKind] = CardKind.RUN_CONTEXT

    run_id: str
    title: str
    error_code: str
    message: str
    trace_ref: str = ""


@dataclass
class PreflightContextCard(_Card):
    """Checklist-fix injected context (spec §4.3)."""

    kind: ClassVar[CardKind] = CardKind.PREFLIGHT_CONTEXT

    node_count: int
    issue_count: int
    issues: list[PreflightIssue] = field(default_factory=list)


@dataclass
class AssistantTurnItem(_Card):
    """The streamable unit (spec §4.2). ``stage_id`` is the PcState this
    turn ran in; ``cards`` lists which cards (in order) this turn attaches.
    ``card_state`` is ``None`` or ``"invalidated"`` (frozen after task exit).
    """

    kind: ClassVar[CardKind] = CardKind.ASSISTANT_TURN

    turn_id: str
    stage_id: str
    trace: Trace
    reply_text: str | None = None
    cards: list[str] = field(default_factory=list)
    card_state: str | None = None


@dataclass
class PlanCard(_Card):
    """Versioned plan (spec §4.3). ``items`` are ordered, human-readable
    steps. Build emits v1/v2/v2.x; Edit emits a single change plan.
    """

    kind: ClassVar[CardKind] = CardKind.PLAN

    title: str
    version_tag: str
    items: list[str] = field(default_factory=list)
    subtitle: str | None = None


@dataclass
class FormCard(_Card):
    """Editable, re-submittable input card. ``variant`` in
    build_requirements|edit_rules.
    """

    kind: ClassVar[CardKind] = CardKind.FORM

    variant: str
    fields: list[FormField] = field(default_factory=list)
    values: dict = field(default_factory=dict)
    frozen: bool = False


@dataclass
class ChallengeCard(_Card):
    """High-impact-rule confirmation, distinct from a plain question."""

    kind: ClassVar[CardKind] = CardKind.CHALLENGE

    title: str
    body: str
    tone: str = "warning"


@dataclass
class ResourceSelectCard(_Card):
    """Resource discovery: multi-select ``recommended`` resources +
    single-select ``conflict_policy_options``.
    """

    kind: ClassVar[CardKind] = CardKind.RESOURCE_SELECT

    recommended: list[ResourceOption] = field(default_factory=list)
    conflict_policy_options: list[ConflictPolicyOption] = field(default_factory=list)


@dataclass
class CheckpointCard(_Card):
    """Restore point, backed by create-checkpoint/revert-checkpoint canvas
    events. Restoring invalidates prior approvals.
    """

    kind: ClassVar[CardKind] = CardKind.CHECKPOINT

    checkpoint_id: str
    label: str
    created_at: str


@dataclass
class ChangeSetCard(_Card):
    """Collapsible diff. ``scope`` in annotation|configuration|structure.
    The ``view_changes`` action forces ``full_diff_open``.
    """

    kind: ClassVar[CardKind] = CardKind.CHANGE_SET

    count: int
    changes: list[str]
    scope: str
    full_diff_open: bool = False


@dataclass
class TestResultCard(_Card):
    """Structured test/verify result. ``tone`` in success|error."""

    # Not a pytest test class; ``__test__`` (unannotated, so not a dataclass
    # field) tells pytest's Test*-name collector to skip it.
    __test__ = False

    kind: ClassVar[CardKind] = CardKind.TEST_RESULT

    title: str
    subtitle: str
    tone: str
    stats: list[TestStat] = field(default_factory=list)
    run_ids: list[str] = field(default_factory=list)


@dataclass
class ErrorCard(_Card):
    """A found/fixed problem."""

    kind: ClassVar[CardKind] = CardKind.ERROR

    title: str
    body: str
    tone: str = "danger"
    node_id: str | None = None


@dataclass
class SummaryCard(_Card):
    """Polymorphic by phase. ``variant`` in context|review|completion --
    ``items`` is used for context/review, ``rows`` for completion.
    """

    kind: ClassVar[CardKind] = CardKind.SUMMARY

    variant: str
    title: str | None = None
    items: list[str] = field(default_factory=list)
    rows: list[SummaryRow] = field(default_factory=list)


@dataclass
class PublishCard(_Card):
    """Publish confirmation. Build -> v1.0, Edit -> v2.4-style bump, Fix ->
    patch bump.
    """

    kind: ClassVar[CardKind] = CardKind.PUBLISH

    version: str
    badge: str = "live"


@dataclass
class BuildLearningCard(_Card):
    """Post-build "sink this experience into System Skills?" card.

    Deferred -- contract-only for now. ``policy`` is a
    ``SkillLearningPolicy`` value; ``state`` in pending|accepted|skipped.
    """

    kind: ClassVar[CardKind] = CardKind.BUILD_LEARNING

    policy: str
    state: str


# ---------------------------------------------------------------------------
# Typed submit payloads (spec §5, ``SubmitPayloadKind``). Plain dataclasses
# -- no ``kind`` discriminant, no ``to_item``: these are POSTed by the FE as
# ``Action.payload``, never persisted as conversation items.
# ---------------------------------------------------------------------------


@dataclass
class GoalPayload:
    text: str


@dataclass
class EditGoalPayload:
    text: str


@dataclass
class RequirementsPayload:
    report_types: str
    audience: str
    currency: str
    metrics: str
    output: str
    prefer_audited: bool = False


@dataclass
class EditRulesPayload:
    risk_threshold: str
    review_team: str
    timeout_behavior: str
    preserve_summary: bool = False


@dataclass
class ResourcesPayload:
    conflict_policy: str
    resource_ids: list[str] = field(default_factory=list)


@dataclass
class RunContextPayload:
    run_id: str
    node_name: str
    error_code: str


@dataclass
class CheckpointPayload:
    checkpoint_id: str


@dataclass
class TestPayload:
    # Not a pytest test class; ``__test__`` (unannotated, so not a dataclass
    # field) tells pytest's Test*-name collector to skip it.
    __test__ = False

    run_ids: list[str] = field(default_factory=list)


@dataclass
class PublishPayload:
    version: str


@dataclass
class TestdataPayload:
    """``mode`` in upload|self_test|mock."""

    mode: str
    inputs: dict | None = None
