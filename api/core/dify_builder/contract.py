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
from typing import Any, ClassVar, Literal

from core.dify_builder.models import ConversationItem, EntryMode


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

    ``processing`` => ``canvas_read_only = true`` (WORKING).
    ``waiting_*``/``paused`` => editable (WAITING).
    ``complete``/``failed`` => terminal.
    """

    PROCESSING = "processing"
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
    RESOURCE_SELECT = "resource_select"
    TEST_RESULT = "test_result"


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


class BuilderErrorCode(StrEnum):
    """Stable HTTP error codes returned by the Builder console routes."""

    BAD_REQUEST = "bad_request"
    NOT_FOUND = "not_found"
    CONFLICT = "conflict"
    SESSION_BUSY = "session_busy"
    FEATURE_UNAVAILABLE = "feature_unavailable"
    MODEL_UNAVAILABLE = "model_unavailable"


def post_canvas_action_id(state: object, action_kind: object) -> str | None:
    """Return the browser follow-up needed after a repair graph refresh."""
    if action_kind not in {"approve_plan", "approve_repair"}:
        return None
    if state == "build.await_repair":
        return "run_test"
    if state == "edit.await_repair":
        return "run_affected_tests"
    return None


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


# The only two buttons an interactive card shows; every real choice is an option
# inside it. One interaction shape at every gate, not one per state.
CONFIRM_ACTION_ID = "confirm"
CANCEL_ACTION_ID = "cancel"


@dataclass
class OptionInput:
    """Free text an option reveals once selected ("Something else", "Reject with a reason").

    Bounds are declared for the client to enforce; see ``Decision`` for why the
    server does not reject on them yet.
    """

    placeholder: str = ""
    min_length: int = 0
    max_length: int = 100
    required: bool = True


@dataclass
class CardOption:
    """One answer a gate offers, inside the card instead of as a button.

    ``id`` is the former standalone action id, unchanged, so an option resolves
    to exactly the handler kind its button used to.
    """

    id: str
    label: str
    # The second line under an option. Empty for now: the per-state action table
    # carries labels only, and writing the copy here is a product decision.
    description: str = ""
    # Shown as a DEFAULT badge. Advisory only -- these gates have side effects,
    # so declining to choose must never apply anything.
    is_default: bool = False
    tone: str = "neutral"  # neutral | destructive
    input: OptionInput | None = None
    next_state: str | None = None
    canvas_event: str | None = None


@dataclass
class Decision:
    """What the current gate asks: card options plus the fixed button pair.

    Replaces the per-state action bar. The client renders ``options`` in the
    active card, shows only ``confirm`` and ``cancel``, and on confirm posts
    ``confirm`` with ``{"option_id": ..., "free_text": ...}``. ``cancel`` is
    presentational -- it dismisses without posting and the gate stays open.

    While ``SessionView.actions`` is still populated, the server accepts the old
    per-action ids too and does not enforce ``OptionInput`` bounds, so a client
    posting a bare action id keeps working. Enforcement moves server-side when
    ``actions`` goes.
    """

    options: list[CardOption] = field(default_factory=list)
    confirm: Action | None = None
    cancel: Action | None = None
    default_option_id: str = ""


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


@dataclass
class BuilderError:
    """Error body returned before an SSE response starts, or by a JSON route.

    ``message`` and ``recoverable`` are optional extension fields. Current
    responses only require the stable ``code`` field.
    """

    code: BuilderErrorCode
    message: str | None = None
    recoverable: bool | None = None


# ---------------------------------------------------------------------------
# Card sub-types (spec §4.3). Plain dataclasses -- no ``kind`` discriminant,
# they nest inside a card's fields rather than standing alone in the
# conversation.
# ---------------------------------------------------------------------------


@dataclass
class FormField:
    """One field of a ``form`` card, including Start-node input constraints."""

    key: str
    label: str
    type: str
    options: list[str] = field(default_factory=list)
    required: bool = False
    default: str | int | float | bool | None = None
    max_length: int | None = field(default=None, metadata={"minimum": 1})
    allowed_file_types: list[str] = field(default_factory=list)
    allowed_file_extensions: list[str] = field(default_factory=list)
    allowed_file_upload_methods: list[str] = field(default_factory=list)
    placeholder: str | None = None
    hint: str | None = None
    unit: str | None = None
    json_schema: str | dict[str, Any] | None = None
    number_limits: int | None = field(default=None, metadata={"minimum": 1})


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
class AppRevision:
    """Shared draft-workflow revision associated with a private session.

    ``observed`` is the revision last incorporated by the Builder engine;
    ``current`` is read from the app draft when this SessionView is built.
    A mismatch tells the client to refresh/rebase before submitting a
    workflow-dependent action.
    """

    observed: str
    current: str
    conflicted: bool


@dataclass
class ActiveInteraction:
    """The one persisted card that may accept input at the current version.

    Historical cards remain renderable, but the client must only enable this
    card. ``valid_at_version`` is an explicit fence in addition to the normal
    action ``base_version`` check.
    """

    action_id: str
    card: ConversationItem
    valid_at_version: int


@dataclass
class ConversationPage:
    """A group-safe page of durable conversation items.

    ``limit`` at the HTTP boundary counts rendered conversation groups rather
    than raw rows, so a card bundle is never split from its assistant turn.
    Items inside the page stay in ascending ``seq`` order.
    """

    data: list[ConversationItem]
    has_more: bool
    first_seq: int | None
    last_seq: int | None


@dataclass
class SessionView:
    """Bounded read model returned by Builder session-facing routes.

    Conversation history deliberately lives behind ``ConversationPage``. This
    object is safe to send at command start/end without payload growth as a
    session gets older.
    """

    session_id: str
    app_id: str
    version: int
    state: str
    canvas_read_only: bool
    run_status: RunStatus
    interrupted: bool
    conversation_last_seq: int
    entry_mode: EntryMode = EntryMode.FIX
    phase: Phase = Phase.UNDERSTAND
    # DEPRECATED until the web client reads ``decision``: the same choice, in
    # the standalone-button shape.
    actions: list[Action] = field(default_factory=list)
    decision: Decision | None = None
    active_interaction: ActiveInteraction | None = None
    checkpoint: CheckpointRef | None = None
    recovery: RecoveryRef | None = None
    model: SessionModel | None = None
    app_revision: AppRevision | None = None
    # The last command whose durable transition is reflected by this view.
    # Used by reconnecting clients to correlate a terminal projection without
    # replaying the command's conversation payload in SSE.
    last_command_id: str = ""


@dataclass
class PreflightIssue:
    """One checklist finding in a ``preflight_context`` card.

    Carries the workflow checklist fields needed by Dify Builder's own
    preflight component. The Builder presentation remains independently
    maintained from the editor checklist.
    """

    node_id: str
    node_type: str
    title: str
    messages: list[str] = field(default_factory=list)
    unconnected: bool = False
    plugin_missing: bool = False


ExecutionActivityState = Literal["active", "done", "failed", "stopped"]
ExecutionActivityKind = Literal["stage", "node"]
ExecutionProgressStatus = Literal["running", "completed", "error", "stopped"]


@dataclass
class ExecutionActivity:
    """One observable action that has started during a Builder operation.

    Planned future work is intentionally absent. Node activities use
    ``parent_id`` to sit under the stage that owns the workflow run.
    """

    id: str
    label: str
    state: ExecutionActivityState
    kind: ExecutionActivityKind = "stage"
    parent_id: str | None = None


@dataclass
class ExecutionProgress:
    """A snapshot containing only execution activities observed so far."""

    status: ExecutionProgressStatus
    activities: list[ExecutionActivity] = field(default_factory=list)


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
    turn_id: str


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
    execution: ExecutionProgress
    reasoning_text: str | None = None
    reply_text: str | None = None
    cards: list[str] = field(default_factory=list)
    card_state: str | None = None


@dataclass
class PlanCard(_Card):
    """Final approval plan. ``items`` are ordered, human-readable steps."""

    kind: ClassVar[CardKind] = CardKind.PLAN

    title: str
    items: list[str] = field(default_factory=list)


@dataclass
class FormCard(_Card):
    """Editable, re-submittable input card. ``variant`` in
    build_requirements|edit_rules|testdata.
    """

    kind: ClassVar[CardKind] = CardKind.FORM

    variant: str
    fields: list[FormField] = field(default_factory=list)
    values: dict = field(default_factory=dict)
    frozen: bool = False


@dataclass
class ResourceSelectCard(_Card):
    """Resource discovery: multi-select ``recommended`` resources."""

    kind: ClassVar[CardKind] = CardKind.RESOURCE_SELECT

    recommended: list[ResourceOption] = field(default_factory=list)


@dataclass
class TestResultCard(_Card):
    """Minimal test/verify result shown after a run completes."""

    # Not a pytest test class; ``__test__`` (unannotated, so not a dataclass
    # field) tells pytest's Test*-name collector to skip it.
    __test__ = False

    kind: ClassVar[CardKind] = CardKind.TEST_RESULT

    status: Literal["succeeded", "failed"]
    failure_reason: str | None = None
    # The Dify workflow run these results came from, so a client can reopen
    # the run on the canvas later. Persisted because SSE does not survive a
    # page reload. "" when no run backs the card.
    dify_run_id: str = ""


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


# ---------------------------------------------------------------------------
# SSE payloads. ``_SseEventData`` is the shared wire-payload marker. Each payload
# declares its envelope event name as the ``sse_event`` ClassVar. Bus-level
# ``kind`` remains on payloads while the HTTP transport wraps each value in a
# generated ``{ event, data }`` response envelope.
# ---------------------------------------------------------------------------


class _SseEventData:
    sse_event: ClassVar[str]


@dataclass
class CommandStartedEventData(SessionView, _SseEventData):
    """Bounded command/reconnect handshake; never contains conversation history."""

    sse_event: ClassVar[str] = "command_started"

    command_id: str = ""
    kind: Literal["command_started"] = "command_started"


@dataclass
class WorkflowEventData(_SseEventData):
    sse_event: ClassVar[str] = "workflow"

    session_id: str
    operation_id: str
    stage_id: str
    at_version: int
    revision: int
    payload: dict[str, object]
    kind: Literal["workflow"] = "workflow"


@dataclass
class CanvasEdge:
    source: str
    target: str


@dataclass
class CanvasEventData(_SseEventData):
    sse_event: ClassVar[str] = "canvas"

    session_id: str
    operation_id: str
    stage_id: str
    at_version: int
    revision: int
    event: CanvasEvent
    kind: Literal["canvas"] = "canvas"
    node_id: str | None = None
    edge: CanvasEdge | None = None
    dify_run_id: str = ""


@dataclass
class AgentMessageEventData(_SseEventData):
    """One incremental assistant-text chunk for an in-flight chat turn.

    ``delta`` is never an accumulated answer. Every frame for one assistant
    message carries the same preallocated ``seq``/``turn_id``. The final frame
    has ``done=true`` and an empty ``delta``; it is emitted after the assistant
    turn commits and promotes the accumulated text into the live conversation.
    ``command_finished`` later confirms the command's complete bounded state.
    """

    sse_event: ClassVar[str] = "agent_message"

    session_id: str
    command_id: str
    operation_id: str
    turn_id: str
    delta: str
    seq: int
    at_version: int
    revision: int
    stage_id: str
    done: bool
    # Cumulative UTF-8 byte length after applying this delta. The final marker
    # lets clients detect a missing chunk without replaying the full reply.
    text_bytes: int
    execution: ExecutionProgress | None = None
    cards: list[str] = field(default_factory=list)
    kind: Literal["agent_message"] = "agent_message"


@dataclass
class ConversationItemAppendedEventData(_SseEventData):
    """One durable non-assistant conversation item appended by a command.

    Assistant text is intentionally excluded: its preallocated sequence and
    content already arrive through ``agent_message``. The persisted
    ``assistant_turn`` remains available from the history endpoint for reload
    and recovery only.
    """

    sse_event: ClassVar[str] = "conversation_item_appended"

    session_id: str
    command_id: str
    item: ConversationItem
    kind: Literal["conversation_item_appended"] = "conversation_item_appended"


@dataclass
class ReasoningEventData(_SseEventData):
    """One model-provided reasoning delta for the current operation.

    Reasoning is independent from curated execution progress. ``span_id``
    identifies the cognitive call within an operation so clients can preserve
    stable rendering while deltas arrive.
    """

    sse_event: ClassVar[str] = "reasoning"

    session_id: str
    operation_id: str
    stage_id: str
    at_version: int
    revision: int
    span_id: str
    delta: str
    kind: Literal["reasoning"] = "reasoning"


@dataclass
class ProgressEventData(_SseEventData):
    """One ordered execution-activity delta for an in-flight operation.

    ``revision`` is monotonic within ``operation_id``. ``at_version`` points
    at the next durable transition that supersedes these deltas, allowing a
    client to discard delayed progress after it has reconciled the terminal command.
    ``activity`` is null only when the operation status changes without an
    activity mutation. Model-provided reasoning is delivered separately through
    ``ReasoningEventData``. The terminal assistant item still carries the full
    ``ExecutionProgress`` snapshot for durable history.
    """

    sse_event: ClassVar[str] = "progress"

    session_id: str
    operation_id: str
    stage_id: str
    at_version: int
    revision: int
    status: ExecutionProgressStatus
    activity: ExecutionActivity | None
    kind: Literal["progress"] = "progress"


@dataclass
class CommandFinishedEventData(SessionView, _SseEventData):
    """Terminal session projection for one command.

    Conversation content is intentionally absent. ``conversation_last_seq``
    is a persistence watermark: clients only query history when the item
    events they observed do not cover the completed command's sequence range.
    """

    sse_event: ClassVar[str] = "command_finished"

    command_id: str = ""
    kind: Literal["command_finished"] = "command_finished"


@dataclass
class ErrorEventData(_SseEventData):
    sse_event: ClassVar[str] = "error"

    error: str
    kind: Literal["error"] = "error"
    code: str | None = None
    message: str | None = None
    recoverable: bool | None = None
    session_id: str | None = None
    command_id: str | None = None
