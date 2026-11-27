"""Pydantic request and response schemas for the Console Dify Builder API."""

from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, RootModel, StrictBool, StrictInt, StringConstraints, model_validator

from core.dify_builder.contract import (
    ActionKind,
    AssistantTurnItem,
    BuilderErrorCode,
    CanvasChangeCause,
    Decision,
    DecisionItem,
    ExecutionActivityState,
    ExecutionProgressStatus,
    FormCard,
    InteractionKind,
    InteractionResponseItem,
    LifecycleSettlement,
    NoticeItem,
    Phase,
    PlanCard,
    PreflightContextCard,
    RecoveryRef,
    ResourceSelectCard,
    RunContextCard,
    RunStatus,
    SessionModel,
    SessionTaskStatus,
    TestResultCard,
    UserItem,
)
from core.dify_builder.models import TaskSummary
from fields.base import ResponseModel
from fields.workflow_stream_fields import WorkflowStreamPayload
from runtime_contracts.builder.presentation import BuilderText
from runtime_contracts.builder.string_enum import BuilderStringEnum


class FixControlOperation(BuilderStringEnum):
    FIX = "fix"
    DISMISS_FIX = "dismiss_fix"
    STOP_AND_SWITCH_FIX = "stop_and_switch_fix"


class AttachmentState(BuilderStringEnum):
    PENDING = "pending"
    CONSUMED = "consumed"
    TRUNCATED = "truncated"
    REJECTED = "rejected"


class MaterialReceiptStatus(BuilderStringEnum):
    PENDING = "pending"
    CONSUMED = "consumed"
    TRUNCATED = "truncated"
    REJECTED = "rejected"
    SUPERSEDED = "superseded"


NonEmptyString = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
ClientTurnId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]
# Real-call consent identifiers are bound byte-exactly by the consent owner: no trimming or coercion.
RealCallId = Annotated[str, StringConstraints(min_length=1, max_length=128)]
ScopeDigest = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
IdempotencyKey = Annotated[str, StringConstraints(min_length=1, max_length=128)]
ReasonCode = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,127}$")]


class DifyBuilderPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class DifyBuilderAttachmentPayload(DifyBuilderPayload):
    """An opaque native upload reference; authority is reconstructed server-side."""

    upload_file_id: UUID


class DifyBuilderMaterialPayload(DifyBuilderPayload):
    attachments: list[DifyBuilderAttachmentPayload] = Field(default_factory=list, max_length=5)


class DifyBuilderGoalPayload(DifyBuilderMaterialPayload):
    goal_text: Annotated[str, StringConstraints(strip_whitespace=True, max_length=20000)] = ""

    @model_validator(mode="after")
    def require_goal_or_material(self) -> "DifyBuilderGoalPayload":
        if not self.goal_text and not self.attachments:
            raise ValueError("goal_text or attachments are required")
        return self


class DifyBuilderCreateBuildSessionPayload(DifyBuilderGoalPayload):
    app_id: NonEmptyString
    scenario: Literal["build"]
    # True when the app was created from this same prompt and still carries the
    # name cut from it, so Builder may rewrite it once it understands the goal.
    # False is create-from-blank: the user named the app, Builder inherits it.
    model_config_data: SessionModel | None = Field(default=None, alias="model_config")


class DifyBuilderCreateEditSessionPayload(DifyBuilderGoalPayload):
    app_id: NonEmptyString
    scenario: Literal["edit"]
    model_config_data: SessionModel | None = Field(default=None, alias="model_config")


class DifyBuilderCreateFixSessionPayload(DifyBuilderMaterialPayload):
    app_id: NonEmptyString
    scenario: Literal["fix"]
    failed_run_id: NonEmptyString
    session_id: NonEmptyString | None = None
    client_action_id: ClientTurnId | None = None
    model_config_data: SessionModel | None = Field(default=None, alias="model_config")


class DifyBuilderChecklistErrorPayload(DifyBuilderPayload):
    node_id: str
    node_type: str
    title: str
    messages: list[str]
    unconnected: bool
    plugin_missing: bool


class DifyBuilderCreateChecklistFixSessionPayload(DifyBuilderMaterialPayload):
    app_id: NonEmptyString
    scenario: Literal["fix"]
    checklist_errors: Annotated[list[DifyBuilderChecklistErrorPayload], Field(min_length=1)]
    failed_run_id: NonEmptyString | None = None
    session_id: NonEmptyString | None = None
    client_action_id: ClientTurnId | None = None
    model_config_data: SessionModel | None = Field(default=None, alias="model_config")


class DifyBuilderCreateSessionPayload(
    RootModel[
        DifyBuilderCreateBuildSessionPayload
        | DifyBuilderCreateEditSessionPayload
        | DifyBuilderCreateFixSessionPayload
        | DifyBuilderCreateChecklistFixSessionPayload
    ]
):
    """Create a Build, Edit, failed-run Fix, or checklist Fix session."""


class DifyBuilderReceiptFieldSnapshot(DifyBuilderPayload):
    key: NonEmptyString
    label: str
    display_value: str


class DifyBuilderReceiptSnapshot(DifyBuilderPayload):
    """Localized display only; submitted values remain in action.payload."""

    interaction_kind: InteractionKind
    reply_language: Annotated[str, StringConstraints(min_length=1, max_length=35)]
    # Display metadata must not impose limits absent from action.payload.
    question: str
    answer: str = ""
    fields: list[DifyBuilderReceiptFieldSnapshot] = Field(default_factory=list)


class DifyBuilderTaskControlPayload(DifyBuilderPayload):
    """Control the current task with a durable client replay identity."""

    base_version: StrictInt
    client_action_id: ClientTurnId
    base_app_revision: str = ""


class DifyBuilderConversationLifecyclePayload(DifyBuilderPayload):
    """Lifecycle control uses Session CAS, never a graph revision."""

    base_version: StrictInt = Field(ge=1)
    client_action_id: ClientTurnId
    expected_task_id: str = Field(default="", max_length=255)


class DifyBuilderClearConversationPayload(DifyBuilderConversationLifecyclePayload):
    confirmed: StrictBool

    @model_validator(mode="after")
    def require_confirmation(self) -> "DifyBuilderClearConversationPayload":
        if self.confirmed is not True:
            raise ValueError("Explicit clear confirmation is required")
        return self


class DifyBuilderFixIntentPayload(DifyBuilderPayload):
    base_version: StrictInt = Field(ge=1)
    client_action_id: ClientTurnId
    failed_run_id: NonEmptyString | None = None
    checklist_errors: list[DifyBuilderChecklistErrorPayload] = Field(default_factory=list, max_length=100)
    model_config_data: SessionModel | None = Field(default=None, alias="model_config")

    @model_validator(mode="after")
    def require_one_source(self) -> "DifyBuilderFixIntentPayload":
        if bool(self.failed_run_id) == bool(self.checklist_errors):
            raise ValueError("Exactly one failed run or checklist source is required")
        return self


class DifyBuilderFixControlQuery(DifyBuilderPayload):
    operation: FixControlOperation
    client_action_id: ClientTurnId
    base_version: int = Field(ge=1)
    fix_intent_id: NonEmptyString | None = None
    expected_task_id: NonEmptyString | None = None

    @model_validator(mode="after")
    def require_decision_identity(self) -> "DifyBuilderFixControlQuery":
        if self.operation != "fix" and (not self.fix_intent_id or not self.expected_task_id):
            raise ValueError("Fix decision identity is required")
        return self


class DifyBuilderFixControlResponse(ResponseModel):
    session_id: str
    operation: FixControlOperation
    client_action_id: str
    base_version: int
    fix_intent_id: str
    target_task_id: str
    status: str
    acknowledged: bool


class DifyBuilderConversationLifecycleResponse(ResponseModel):
    session_id: str
    version: int
    last_command_id: str
    task_id: str
    task_status: Literal["abandoned"]
    conversation_cleared: bool
    conversation_last_seq: int
    settlement: LifecycleSettlement


class DifyBuilderSubmitActionPayload(DifyBuilderPayload):
    action_id: NonEmptyString
    client_action_id: ClientTurnId | None = None
    receipt_snapshot: DifyBuilderReceiptSnapshot | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    base_version: StrictInt
    base_app_revision: NonEmptyString


class DifyBuilderSubmitMessagePayload(DifyBuilderMaterialPayload):
    text: Annotated[str, StringConstraints(strip_whitespace=True, max_length=20000)] = ""
    base_version: StrictInt
    client_turn_id: ClientTurnId

    @model_validator(mode="after")
    def require_text_or_material(self) -> "DifyBuilderSubmitMessagePayload":
        if not self.text and not self.attachments:
            raise ValueError("text or attachments are required")
        return self


class DifyBuilderConversationListQuery(DifyBuilderPayload):
    before_seq: int | None = Field(default=None, ge=0, description="Load groups before this sequence")
    after_seq: int | None = Field(default=None, ge=-1, description="Load groups after this sequence")
    limit: int = Field(default=20, ge=1, le=100, description="Number of conversation groups to return")

    @model_validator(mode="after")
    def validate_cursor(self) -> "DifyBuilderConversationListQuery":
        if self.before_seq is not None and self.after_seq is not None:
            raise ValueError("before_seq and after_seq are mutually exclusive")
        return self


# Real-call consent requests name what a person reviews or approves. They never
# carry Tool parameters, credentials, graph, execution context or guards: the
# consent owner reconstructs all of those server-side from authoritative rows.


class DifyBuilderConversationItemBase(ResponseModel):
    seq: int
    at_version: int


class DifyBuilderUserConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["user"]
    payload: UserItem


class DifyBuilderDecisionConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["decision"]
    payload: DecisionItem


class DifyBuilderInteractionResponseConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["interaction_response"]
    payload: InteractionResponseItem


class DifyBuilderNoticeConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["notice"]
    payload: NoticeItem


class DifyBuilderRunContextConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["run_context"]
    payload: RunContextCard


class DifyBuilderPreflightContextConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["preflight_context"]
    payload: PreflightContextCard


class DifyBuilderAssistantTurnConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["assistant_turn"]
    payload: AssistantTurnItem


class DifyBuilderPlanConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["plan"]
    payload: PlanCard


class DifyBuilderFormConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["form"]
    payload: FormCard


class DifyBuilderResourceSelectConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["resource_select"]
    payload: ResourceSelectCard


class DifyBuilderTestResultConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["test_result"]
    payload: TestResultCard


DifyBuilderConversationItem = Annotated[
    DifyBuilderUserConversationItemResponse
    | DifyBuilderDecisionConversationItemResponse
    | DifyBuilderInteractionResponseConversationItemResponse
    | DifyBuilderNoticeConversationItemResponse
    | DifyBuilderRunContextConversationItemResponse
    | DifyBuilderPreflightContextConversationItemResponse
    | DifyBuilderAssistantTurnConversationItemResponse
    | DifyBuilderPlanConversationItemResponse
    | DifyBuilderFormConversationItemResponse
    | DifyBuilderResourceSelectConversationItemResponse
    | DifyBuilderTestResultConversationItemResponse,
    Field(discriminator="kind"),
]

# Complete assistant presentation arrives as a committed item. Native streamed
# assistant text is restricted to agent_message by the event validator.
DifyBuilderAppendedConversationItem = Annotated[
    DifyBuilderUserConversationItemResponse
    | DifyBuilderDecisionConversationItemResponse
    | DifyBuilderInteractionResponseConversationItemResponse
    | DifyBuilderNoticeConversationItemResponse
    | DifyBuilderRunContextConversationItemResponse
    | DifyBuilderPreflightContextConversationItemResponse
    | DifyBuilderAssistantTurnConversationItemResponse
    | DifyBuilderPlanConversationItemResponse
    | DifyBuilderFormConversationItemResponse
    | DifyBuilderResourceSelectConversationItemResponse
    | DifyBuilderTestResultConversationItemResponse,
    Field(discriminator="kind"),
]


class DifyBuilderActiveInteractionResponse(ResponseModel):
    action_id: str
    card_seq: int
    valid_at_version: int


class DifyBuilderActionResponse(ResponseModel):
    payload: dict[str, Any] = Field(default_factory=dict)
    id: str
    label: BuilderText
    kind: ActionKind


class DifyBuilderAppRevisionResponse(ResponseModel):
    current: str
    conflicted: bool


class DifyBuilderAttachmentStateResponse(ResponseModel):
    upload_file_id: UUID
    name: str
    extension: str
    size: int
    status: AttachmentState
    digest: str = ""
    reason: str = ""


class DifyBuilderMaterialReceiptResponse(ResponseModel):
    id: UUID
    seq: int
    app_id: str
    session_id: str
    task_id: str
    generation: int
    client_turn_id: str
    status: MaterialReceiptStatus
    consumed_version: int | None
    test_input_candidate: bool
    attachments: list[DifyBuilderAttachmentStateResponse] = Field(max_length=5)


class DifyBuilderSessionStateResponse(ResponseModel):
    attachments: list[DifyBuilderMaterialReceiptResponse] = Field(default_factory=list, max_length=100)
    diagnostics: list[dict[str, Any]] = Field(default_factory=list, max_length=33)
    session_id: str
    reply_language: str = Field(
        description="Detected user-input language (BCP-47); empty until a user language is detected."
    )
    version: int
    canvas_read_only: bool
    run_status: RunStatus
    command_pending: bool = False
    interrupted: bool
    conversation_last_seq: int
    phase: Phase
    actions: list[DifyBuilderActionResponse] = Field(default_factory=list)
    decision: Decision | None = None
    active_interaction: DifyBuilderActiveInteractionResponse | None = None
    recovery: RecoveryRef | None = None
    model: SessionModel | None = None
    app_revision: DifyBuilderAppRevisionResponse | None = None
    task_id: str = ""
    task_status: SessionTaskStatus = SessionTaskStatus.ACTIVE
    task_summaries: list[TaskSummary] = Field(default_factory=list, max_length=8)
    conversation_cleared: bool = False
    lifecycle_settlement: LifecycleSettlement | None = Field(
        default=None,
        description=(
            "Known execution state of the current clear/abandon control, not physical cleanup proof. "
            "Null means no applicable control; missing applicable evidence is unknown. "
            "Clear retains its durable acknowledgment state without inferring later cleanup."
        ),
    )
    pending_fix_context: RunContextCard | PreflightContextCard | None = None


class DifyBuilderSessionViewResponse(DifyBuilderSessionStateResponse):
    last_command_id: str = ""


class DifyBuilderCreatedSessionResponse(ResponseModel):
    session: DifyBuilderSessionViewResponse
    requires_start: bool


class DifyBuilderCommandSubmissionResponse(ResponseModel):
    command_id: str
    pending: bool
    session: DifyBuilderSessionViewResponse | None = None


class DifyBuilderFixIntentResponse(ResponseModel):
    fix_intent_id: str
    status: str
    session: DifyBuilderSessionViewResponse


class DifyBuilderConversationPageResponse(ResponseModel):
    data: list[DifyBuilderConversationItem]
    has_more: bool
    first_seq: int | None
    last_seq: int | None


class DifyBuilderCommandFinishedEventData(DifyBuilderSessionStateResponse):
    command_id: str
    post_canvas_action_id: str | None = None


class DifyBuilderCommandStartedEventData(ResponseModel):
    session_id: str
    command_id: str
    version: int
    phase: Phase
    run_status: RunStatus


class DifyBuilderCommandStartedEventResponse(ResponseModel):
    event: Literal["command_started"]
    data: DifyBuilderCommandStartedEventData


class DifyBuilderWorkflowEventData(ResponseModel):
    session_id: str
    operation_id: str
    at_version: int
    revision: int
    payload: WorkflowStreamPayload


class DifyBuilderWorkflowEventResponse(ResponseModel):
    event: Literal["workflow"]
    data: DifyBuilderWorkflowEventData


class DifyBuilderCanvasEventBase(ResponseModel):
    session_id: str
    operation_id: str
    at_version: int
    revision: int


class DifyBuilderGraphChangedEventData(DifyBuilderCanvasEventBase):
    event: Literal["graph_changed"]
    cause: CanvasChangeCause


class DifyBuilderEditTargetsChangedEventData(DifyBuilderCanvasEventBase):
    event: Literal["edit_targets_changed"]
    node_ids: list[str]


class DifyBuilderPublishedEventData(DifyBuilderCanvasEventBase):
    event: Literal["publish_workflow"]


DifyBuilderCanvasEventData = Annotated[
    DifyBuilderGraphChangedEventData | DifyBuilderEditTargetsChangedEventData | DifyBuilderPublishedEventData,
    Field(discriminator="event"),
]


class DifyBuilderCanvasEventResponse(ResponseModel):
    event: Literal["canvas"]
    data: DifyBuilderCanvasEventData


class DifyBuilderExecutionActivityResponse(ResponseModel):
    id: str
    label: BuilderText
    state: ExecutionActivityState
    parent_id: str | None = None


class DifyBuilderExecutionProgressResponse(ResponseModel):
    status: ExecutionProgressStatus
    activities: list[DifyBuilderExecutionActivityResponse] = Field(default_factory=list)


class DifyBuilderAgentMessageEventData(ResponseModel):
    session_id: str
    command_id: str
    operation_id: str
    turn_id: str
    delta: str
    seq: int
    at_version: int
    revision: int
    done: bool
    text_bytes: int
    execution: DifyBuilderExecutionProgressResponse | None = None
    cards: list[str] = Field(default_factory=list)


class DifyBuilderAgentMessageEventResponse(ResponseModel):
    event: Literal["agent_message"]
    data: DifyBuilderAgentMessageEventData


class DifyBuilderConversationItemAppendedEventData(ResponseModel):
    session_id: str
    command_id: str
    item: DifyBuilderAppendedConversationItem

    @model_validator(mode="after")
    def complete_assistant_only(self):
        if self.item.kind == "assistant_turn" and self.item.payload.reply_mode != "complete":
            raise ValueError("streamed assistant turns use agent_message")
        return self


class DifyBuilderConversationItemAppendedEventResponse(ResponseModel):
    event: Literal["conversation_item_appended"]
    data: DifyBuilderConversationItemAppendedEventData


class DifyBuilderReasoningEventData(ResponseModel):
    session_id: str
    operation_id: str
    at_version: int
    revision: int
    delta: str


class DifyBuilderReasoningEventResponse(ResponseModel):
    event: Literal["reasoning"]
    data: DifyBuilderReasoningEventData


class DifyBuilderProgressEventData(ResponseModel):
    session_id: str
    operation_id: str
    at_version: int
    revision: int
    status: ExecutionProgressStatus
    activity: DifyBuilderExecutionActivityResponse | None
    reply_language: str = ""


class DifyBuilderProgressEventResponse(ResponseModel):
    event: Literal["progress"]
    data: DifyBuilderProgressEventData


class DifyBuilderProgressSnapshotEventData(ResponseModel):
    """Complete observed activity state before subsequent live progress deltas."""

    session_id: str
    operation_id: str
    at_version: int
    revision: int
    reply_language: str
    execution: DifyBuilderExecutionProgressResponse


class DifyBuilderProgressSnapshotEventResponse(ResponseModel):
    event: Literal["progress_snapshot"]
    data: DifyBuilderProgressSnapshotEventData


class DifyBuilderCommandFinishedEventResponse(ResponseModel):
    event: Literal["command_finished"]
    data: DifyBuilderCommandFinishedEventData


class DifyBuilderSessionReadyEventResponse(ResponseModel):
    event: Literal["session_ready"]
    data: DifyBuilderSessionViewResponse


class DifyBuilderSessionStateEventResponse(ResponseModel):
    event: Literal["session_state"]
    data: DifyBuilderSessionViewResponse


class DifyBuilderErrorEventData(ResponseModel):
    session_id: str | None = None
    command_id: str | None = None
    code: str | None = None
    message: str
    reason_code: ReasonCode | None = None
    recoverable: bool | None = None


class DifyBuilderErrorEventResponse(ResponseModel):
    event: Literal["error"]
    data: DifyBuilderErrorEventData


class DifyBuilderStreamEventResponse(
    RootModel[
        Annotated[
            DifyBuilderCommandStartedEventResponse
            | DifyBuilderWorkflowEventResponse
            | DifyBuilderCanvasEventResponse
            | DifyBuilderAgentMessageEventResponse
            | DifyBuilderConversationItemAppendedEventResponse
            | DifyBuilderReasoningEventResponse
            | DifyBuilderProgressEventResponse
            | DifyBuilderProgressSnapshotEventResponse
            | DifyBuilderCommandFinishedEventResponse
            | DifyBuilderSessionReadyEventResponse
            | DifyBuilderSessionStateEventResponse
            | DifyBuilderErrorEventResponse,
            Field(discriminator="event"),
        ]
    ]
):
    """One JSON object carried by an SSE ``data:`` frame."""


class DifyBuilderErrorResponse(ResponseModel):
    reason_code: ReasonCode | None = None
    code: BuilderErrorCode
    message: str | None = None
    recoverable: bool | None = None


class DifyBuilderFeatureUnavailableResponse(ResponseModel):
    """Builder is not enabled for the workspace (the shared ``dify_builder_required`` gate)."""

    code: Literal["feature_unavailable"]
