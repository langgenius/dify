"""Pydantic request and response schemas for the Console Dify Builder API."""

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel, StrictInt, StringConstraints, model_validator

from core.dify_builder.contract import (
    ActionKind,
    AssistantTurnItem,
    BuilderErrorCode,
    CanvasEvent,
    Decision,
    DecisionItem,
    ExecutionActivityState,
    ExecutionProgressStatus,
    FormCard,
    InteractionResponseItem,
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
from core.dify_builder.real_call_consent import ConsentState
from fields.base import ResponseModel
from fields.workflow_stream_fields import WorkflowStreamPayload
from runtime_contracts.builder.presentation import BuilderText
from services.dify_builder.native_testing.public_contracts import NativeTestInputBinding, NativeTestPublicReceipt

NonEmptyString = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
ClientTurnId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]
# Real-call consent identifiers are bound byte-exactly by the consent owner: no trimming or coercion.
RealCallId = Annotated[str, StringConstraints(min_length=1, max_length=128)]
ScopeDigest = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
IdempotencyKey = Annotated[str, StringConstraints(min_length=1, max_length=128)]
ReasonCode = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,127}$")]


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


class DifyBuilderReceiptFieldSnapshot(DifyBuilderPayload):
    key: NonEmptyString
    label: str
    display_value: str


class DifyBuilderReceiptSnapshot(DifyBuilderPayload):
    """Localized display only; submitted values remain in action.payload."""

    interaction_kind: Literal["choice", "form", "resource"]
    reply_language: Annotated[str, StringConstraints(min_length=1, max_length=35)]
    # Display metadata must not impose limits absent from action.payload.
    question: str
    answer: str = ""
    fields: list[DifyBuilderReceiptFieldSnapshot] = Field(default_factory=list)


class DifyBuilderSubmitActionPayload(DifyBuilderPayload):
    action_id: NonEmptyString
    receipt_snapshot: DifyBuilderReceiptSnapshot | None = None
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


# Real-call consent requests name what a person reviews or approves. They never
# carry Tool parameters, credentials, graph, execution context or guards: the
# consent owner reconstructs all of those server-side from authoritative rows.


class DifyBuilderPrepareRealCallPayload(DifyBuilderPayload):
    node_id: RealCallId
    test_input_id: RealCallId
    credential_id: RealCallId
    at_version: StrictInt = Field(ge=1)
    base_app_revision: RealCallId
    idempotency_key: IdempotencyKey


class DifyBuilderConfirmRealCallPayload(DifyBuilderPayload):
    decision: Literal["confirm", "decline"]
    scope_digest: ScopeDigest
    at_version: StrictInt = Field(ge=1)
    idempotency_key: IdempotencyKey


class DifyBuilderExecuteRealCallPayload(DifyBuilderPayload):
    scope_digest: ScopeDigest
    at_version: StrictInt = Field(ge=1)
    idempotency_key: IdempotencyKey


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
    id: str
    label: BuilderText
    kind: ActionKind


class DifyBuilderAppRevisionResponse(ResponseModel):
    current: str
    conflicted: bool


class DifyBuilderSessionStateResponse(ResponseModel):
    diagnostics: list[dict[str, Any]] = Field(default_factory=list, max_length=33)
    session_id: str
    reply_language: str = Field(
        description="Detected user-input language (BCP-47); empty until a user language is detected."
    )
    version: int
    canvas_read_only: bool
    run_status: RunStatus
    interrupted: bool
    conversation_last_seq: int
    phase: Phase
    actions: list[DifyBuilderActionResponse] = Field(default_factory=list)
    decision: Decision | None = None
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


class DifyBuilderErrorEventData(ResponseModel):
    session_id: str | None = None
    command_id: str | None = None
    code: str | None = None
    message: str


class DifyBuilderErrorEventResponse(ResponseModel):
    event: Literal["error"]
    data: DifyBuilderErrorEventData


class DifyBuilderNativeExecutionEventData(ResponseModel):
    session_id: str
    cursor: ScopeDigest
    receipt: NativeTestPublicReceipt


class DifyBuilderNativeExecutionEventResponse(ResponseModel):
    event: Literal["native_execution"]
    data: DifyBuilderNativeExecutionEventData


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
            | DifyBuilderErrorEventResponse
            | DifyBuilderNativeExecutionEventResponse,
            Field(discriminator="event"),
        ]
    ]
):
    """One JSON object carried by an SSE ``data:`` frame."""


class DifyBuilderErrorResponse(ResponseModel):
    code: BuilderErrorCode
    message: str | None = None
    recoverable: bool | None = None


class DifyBuilderRealCallDisclosureResponse(ResponseModel):
    """The approved public disclosure of one real Tool call; no credential revision or secret."""

    action: Literal["get_message"]
    credential_id: str
    credential_alias: str
    credential_type: str
    identity_basis: Literal["workspace_credential"] = Field(
        description="The alias names a workspace credential, not a verified remote account identity"
    )
    remote_account_status: Literal["unknown"]
    message_id: str
    request_method: Literal["GET"]
    request_url: str
    response_format: Literal["full"]
    include_body: bool
    include_attachments: bool
    oauth_refresh: Literal["if_needed"] = Field(
        description=(
            "One OAuth token refresh request is made only if the stored access token must be refreshed "
            "before the call; otherwise no refresh request is sent"
        )
    )
    oauth_refresh_method: Literal["POST"]
    oauth_refresh_url: Literal["https://oauth2.googleapis.com/token"]
    native_attempt_limit: Literal[1]
    refresh_limit: Literal[1]
    automatic_replay: Literal[False]
    quota_usage: Literal["possible"]
    monetary_estimate: Literal["unknown"]
    output_retention: Literal["native_run_retention"]
    data_description: Literal["gmail_message_headers_snippet_and_selected_body_or_attachment_metadata"]
    expires_at: datetime
    prior_uncertain_consent_id: str | None = None


class DifyBuilderRealCallConsentResponse(ResponseModel):
    """Current or saved receipt of one real-call consent."""

    # The discriminator is always emitted, so document it as required.
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    result: Literal["receipt"] = "receipt"
    consent_id: str
    scope_digest: str
    state: ConsentState = Field(
        description=(
            "Consent lifecycle state. 'unknown' is final: a claimed call whose real effect could not be "
            "confirmed. It is bounded by the disclosed limits of one native attempt and at most one token "
            "refresh, is never replayed automatically, and any further real call needs a new human-approved "
            "consent"
        )
    )
    at_version: int
    disclosure: DifyBuilderRealCallDisclosureResponse
    command_id: str | None
    execution_request_id: str | None
    native_run_id: str | None
    native_node_execution_id: str | None
    reason_code: ReasonCode | None = Field(description="Fixed server reason code; never provider text")
    refresh_claimed: bool
    business_claimed: bool
    can_retry: bool = Field(
        description="Whether a new consent may be prepared; always false once a launch is reserved or claimed"
    )


DifyBuilderRealCallRefusalCode = Literal[
    "needs_setup", "needs_permission", "unsupported_action", "unavailable_metadata", "conflict"
]
DifyBuilderRealCallRefusalReason = Literal[
    # needs_setup
    "needs_setup",
    "credential_required",
    "credential_binding_mismatch",
    "credential_provider_mismatch",
    "unsupported_test_input",
    # needs_permission
    "credential_reference_unavailable",
    "credential_policy_refused",
    # unsupported_action
    "unsupported_action",
    "unsupported_tool_node",
    "unsupported_tool_parameters",
    "unsupported_tool_configuration",
    "unsafe_message_id",
    "unsupported_session_state",
    "unsupported_graph",
    "unsupported_workflow",
    "unsupported_node_retry",
    "unsupported_default_output",
    "unsupported_selector",
    "unsupported_node_implementation",
    "unsupported_node_configuration",
    "invalid_node_configuration",
    "unsupported_start_input",
    "unsupported_input_value",
    "unsupported_features",
    "unsupported_variables",
    "unsupported_external_tracing",
    # unavailable_metadata
    "installed_tool_unavailable",
    "invalid_graph_metadata",
    "session_state_unavailable",
    "real_call_unavailable",
    # conflict
    "stale_session_version",
    "stale_app_revision",
    "stale_consent_version",
    "stale_execution_revision",
    "test_input_binding_mismatch",
    "consent_scope_mismatch",
    "consent_scope_changed",
    "consent_invalidated",
    "consent_expired",
    "consent_not_prepared",
    "consent_not_confirmed",
    "consent_already_claimed",
    "consent_decision_conflict",
    "idempotency_conflict",
    "execution_already_launched",
    "command_lineage_changed",
    "session_busy",
    "session_conflict",
]


class DifyBuilderRealCallRefusalResponse(ResponseModel):
    """Sanitized refusal of a real-call consent operation; carries fixed codes only."""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    result: Literal["refusal"] = "refusal"
    code: DifyBuilderRealCallRefusalCode
    reason_code: DifyBuilderRealCallRefusalReason


class DifyBuilderRealCallPermissionRefusalResponse(ResponseModel):
    """Execution permission refused after ownership was established; nothing foreign is disclosed."""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    result: Literal["refusal"] = "refusal"
    code: Literal["needs_permission"]
    reason_code: Literal["execution_permission_denied"]


class DifyBuilderFeatureUnavailableResponse(ResponseModel):
    """Builder is not enabled for the workspace (the shared ``dify_builder_required`` gate)."""

    code: Literal["feature_unavailable"]


class DifyBuilderConsoleForbiddenResponse(ResponseModel):
    """Console permission-guard denial as serialized by the shared console HTTP error handler."""

    code: Literal["forbidden"]
    message: str
    status: Literal[403]


class DifyBuilderRealCallForbiddenResponse(
    RootModel[
        Annotated[
            DifyBuilderRealCallPermissionRefusalResponse
            | DifyBuilderFeatureUnavailableResponse
            | DifyBuilderConsoleForbiddenResponse,
            Field(discriminator="code"),
        ]
    ]
):
    """Every HTTP 403 body a real-call consent route can return."""


class DifyBuilderNativeTestResponse(ResponseModel):
    """Strict public native receipt; domain DTO also owns generated schemas."""

    data: NativeTestPublicReceipt


class DifyBuilderNativeTestInputResponse(ResponseModel):
    data: NativeTestInputBinding
