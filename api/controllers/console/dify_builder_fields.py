"""Pydantic request and response schemas for the Console Dify Builder API."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel, StrictInt, StringConstraints, model_validator

from core.dify_builder.contract import (
    ActionKind,
    AssistantTurnItem,
    BuilderErrorCode,
    CanvasEvent,
    DecisionItem,
    ExecutionActivityState,
    ExecutionProgressStatus,
    FormCard,
    NoticeItem,
    Phase,
    PlanCard,
    PreflightContextCard,
    RecoveryRef,
    ResourceSelectCard,
    RunContextCard,
    RunStatus,
    SessionModel,
    TestResultCard,
    UserItem,
)
from fields.base import ResponseModel
from fields.workflow_stream_fields import WorkflowStreamPayload

NonEmptyString = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
ClientTurnId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]


class DifyBuilderPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class DifyBuilderCreateBuildSessionPayload(DifyBuilderPayload):
    app_id: NonEmptyString
    scenario: Literal["build"]
    goal_text: NonEmptyString
    # True when the app was created from this same prompt and still carries the
    # name cut from it, so Builder may rewrite it once it understands the goal.
    # False is create-from-blank: the user named the app, Builder inherits it.
    derive_app_name: bool = False
    model_config_data: SessionModel | None = Field(default=None, alias="model_config")


class DifyBuilderCreateEditSessionPayload(DifyBuilderPayload):
    app_id: NonEmptyString
    scenario: Literal["edit"]
    goal_text: NonEmptyString
    model_config_data: SessionModel | None = Field(default=None, alias="model_config")


class DifyBuilderCreateFixSessionPayload(DifyBuilderPayload):
    app_id: NonEmptyString
    scenario: Literal["fix"]
    failed_run_id: NonEmptyString
    model_config_data: SessionModel | None = Field(default=None, alias="model_config")


class DifyBuilderChecklistErrorPayload(DifyBuilderPayload):
    node_id: str
    node_type: str
    title: str
    messages: list[str]
    unconnected: bool
    plugin_missing: bool


class DifyBuilderCreateChecklistFixSessionPayload(DifyBuilderPayload):
    app_id: NonEmptyString
    scenario: Literal["fix"]
    checklist_errors: Annotated[list[DifyBuilderChecklistErrorPayload], Field(min_length=1)]
    failed_run_id: NonEmptyString | None = None
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


class DifyBuilderSubmitActionPayload(DifyBuilderPayload):
    action_id: NonEmptyString
    payload: dict[str, Any] = Field(default_factory=dict)
    base_version: StrictInt
    base_app_revision: NonEmptyString


class DifyBuilderSubmitMessagePayload(DifyBuilderPayload):
    text: NonEmptyString
    base_version: StrictInt
    client_turn_id: ClientTurnId


class DifyBuilderConversationListQuery(DifyBuilderPayload):
    before_seq: int | None = Field(default=None, ge=0, description="Load groups before this sequence")
    after_seq: int | None = Field(default=None, ge=-1, description="Load groups after this sequence")
    limit: int = Field(default=20, ge=1, le=100, description="Number of conversation groups to return")

    @model_validator(mode="after")
    def validate_cursor(self) -> "DifyBuilderConversationListQuery":
        if self.before_seq is not None and self.after_seq is not None:
            raise ValueError("before_seq and after_seq are mutually exclusive")
        return self


class DifyBuilderConversationItemBase(ResponseModel):
    seq: int
    at_version: int


class DifyBuilderUserConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["user"]
    payload: UserItem


class DifyBuilderDecisionConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["decision"]
    payload: DecisionItem


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

# Live item events intentionally exclude assistant_turn. Assistant text has a
# dedicated streaming contract with a preallocated sequence; allowing it here
# would reintroduce a second, conflicting text source for the frontend.
DifyBuilderAppendedConversationItem = Annotated[
    DifyBuilderUserConversationItemResponse
    | DifyBuilderDecisionConversationItemResponse
    | DifyBuilderNoticeConversationItemResponse
    | DifyBuilderRunContextConversationItemResponse
    | DifyBuilderPreflightContextConversationItemResponse
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
    id: str
    label: str
    kind: ActionKind


class DifyBuilderAppRevisionResponse(ResponseModel):
    current: str
    conflicted: bool


class DifyBuilderSessionStateResponse(ResponseModel):
    session_id: str
    version: int
    canvas_read_only: bool
    run_status: RunStatus
    interrupted: bool
    conversation_last_seq: int
    phase: Phase
    actions: list[DifyBuilderActionResponse] = Field(default_factory=list)
    active_interaction: DifyBuilderActiveInteractionResponse | None = None
    recovery: RecoveryRef | None = None
    model: SessionModel | None = None
    app_revision: DifyBuilderAppRevisionResponse | None = None


class DifyBuilderSessionViewResponse(DifyBuilderSessionStateResponse):
    last_command_id: str = ""


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


class DifyBuilderCanvasEventData(ResponseModel):
    session_id: str
    operation_id: str
    at_version: int
    revision: int
    event: CanvasEvent
    node_id: str | None = None


class DifyBuilderCanvasEventResponse(ResponseModel):
    event: Literal["canvas"]
    data: DifyBuilderCanvasEventData


class DifyBuilderExecutionActivityResponse(ResponseModel):
    id: str
    label: str
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


class DifyBuilderProgressEventResponse(ResponseModel):
    event: Literal["progress"]
    data: DifyBuilderProgressEventData


class DifyBuilderCommandFinishedEventResponse(ResponseModel):
    event: Literal["command_finished"]
    data: DifyBuilderCommandFinishedEventData


class DifyBuilderErrorEventData(ResponseModel):
    session_id: str | None = None
    command_id: str | None = None
    code: str | None = None
    message: str


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
            | DifyBuilderCommandFinishedEventResponse
            | DifyBuilderErrorEventResponse,
            Field(discriminator="event"),
        ]
    ]
):
    """One JSON object carried by an SSE ``data:`` frame."""


class DifyBuilderErrorResponse(ResponseModel):
    code: BuilderErrorCode
    message: str | None = None
    recoverable: bool | None = None
