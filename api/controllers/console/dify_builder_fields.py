"""Pydantic request and response schemas for the Console Dify Builder API."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel, StrictInt, StringConstraints, model_validator

from core.dify_builder.contract import (
    Action,
    AgentMessageEventData,
    AppRevision,
    AssistantTurnItem,
    BuilderErrorCode,
    BuildLearningCard,
    CanvasEventData,
    ChallengeCard,
    ChangeSetCard,
    CheckpointCard,
    CheckpointRef,
    DecisionItem,
    ErrorCard,
    ErrorEventData,
    FormCard,
    NodeEventData,
    NoticeItem,
    Phase,
    PlanCard,
    PreflightContextCard,
    ProgressEventData,
    PublishCard,
    RecoveryRef,
    ResourceSelectCard,
    RunContextCard,
    RunStatus,
    SessionModel,
    SummaryCard,
    TestResultCard,
    UserItem,
)
from core.dify_builder.models import EntryMode
from fields.base import ResponseModel

NonEmptyString = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
ClientTurnId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]


class DifyBuilderPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class DifyBuilderCreateBuildSessionPayload(DifyBuilderPayload):
    app_id: NonEmptyString
    scenario: Literal["build"]
    goal_text: NonEmptyString
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


class DifyBuilderChallengeConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["challenge"]
    payload: ChallengeCard


class DifyBuilderResourceSelectConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["resource_select"]
    payload: ResourceSelectCard


class DifyBuilderCheckpointConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["checkpoint"]
    payload: CheckpointCard


class DifyBuilderChangeSetConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["change_set"]
    payload: ChangeSetCard


class DifyBuilderTestResultConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["test_result"]
    payload: TestResultCard


class DifyBuilderErrorConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["error"]
    payload: ErrorCard


class DifyBuilderSummaryConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["summary"]
    payload: SummaryCard


class DifyBuilderPublishConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["publish"]
    payload: PublishCard


class DifyBuilderBuildLearningConversationItemResponse(DifyBuilderConversationItemBase):
    kind: Literal["build_learning"]
    payload: BuildLearningCard


DifyBuilderConversationItem = Annotated[
    DifyBuilderUserConversationItemResponse
    | DifyBuilderDecisionConversationItemResponse
    | DifyBuilderNoticeConversationItemResponse
    | DifyBuilderRunContextConversationItemResponse
    | DifyBuilderPreflightContextConversationItemResponse
    | DifyBuilderAssistantTurnConversationItemResponse
    | DifyBuilderPlanConversationItemResponse
    | DifyBuilderFormConversationItemResponse
    | DifyBuilderChallengeConversationItemResponse
    | DifyBuilderResourceSelectConversationItemResponse
    | DifyBuilderCheckpointConversationItemResponse
    | DifyBuilderChangeSetConversationItemResponse
    | DifyBuilderTestResultConversationItemResponse
    | DifyBuilderErrorConversationItemResponse
    | DifyBuilderSummaryConversationItemResponse
    | DifyBuilderPublishConversationItemResponse
    | DifyBuilderBuildLearningConversationItemResponse,
    Field(discriminator="kind"),
]


class DifyBuilderActiveInteractionResponse(ResponseModel):
    action_id: str
    card: DifyBuilderConversationItem
    valid_at_version: int


class DifyBuilderSessionViewResponse(ResponseModel):
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
    actions: list[Action] = Field(default_factory=list)
    active_interaction: DifyBuilderActiveInteractionResponse | None = None
    checkpoint: CheckpointRef | None = None
    recovery: RecoveryRef | None = None
    model: SessionModel | None = None
    app_revision: AppRevision | None = None


class DifyBuilderConversationPageResponse(ResponseModel):
    data: list[DifyBuilderConversationItem]
    has_more: bool
    first_seq: int | None
    last_seq: int | None


class DifyBuilderCommitEventData(ResponseModel):
    session_id: str
    operation_id: str
    stage_id: str
    at_version: int
    version: int
    state: str
    settled: bool
    items: list[DifyBuilderConversationItem]
    kind: Literal["commit"] = "commit"


class DifyBuilderStateEventData(DifyBuilderSessionViewResponse):
    kind: Literal["state"] = "state"


class DifyBuilderCommandStartedEventData(DifyBuilderSessionViewResponse):
    kind: Literal["command_started"] = "command_started"


class DifyBuilderCommandStartedEventResponse(ResponseModel):
    event: Literal["command_started"]
    data: DifyBuilderCommandStartedEventData


class DifyBuilderNodeEventResponse(ResponseModel):
    event: Literal["node"]
    data: NodeEventData


class DifyBuilderCanvasEventResponse(ResponseModel):
    event: Literal["canvas"]
    data: CanvasEventData


class DifyBuilderAgentMessageEventResponse(ResponseModel):
    event: Literal["agent_message"]
    data: AgentMessageEventData


class DifyBuilderProgressEventResponse(ResponseModel):
    event: Literal["progress"]
    data: ProgressEventData


class DifyBuilderCommitEventResponse(ResponseModel):
    event: Literal["commit"]
    data: DifyBuilderCommitEventData


class DifyBuilderStateEventResponse(ResponseModel):
    event: Literal["state"]
    data: DifyBuilderStateEventData


class DifyBuilderErrorEventResponse(ResponseModel):
    event: Literal["error"]
    data: ErrorEventData


class DifyBuilderStreamEventResponse(
    RootModel[
        Annotated[
            DifyBuilderCommandStartedEventResponse
            | DifyBuilderNodeEventResponse
            | DifyBuilderCanvasEventResponse
            | DifyBuilderAgentMessageEventResponse
            | DifyBuilderProgressEventResponse
            | DifyBuilderCommitEventResponse
            | DifyBuilderStateEventResponse
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
