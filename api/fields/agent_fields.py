from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator

from fields.base import ResponseModel
from libs.helper import to_timestamp
from models.agent import (
    AgentConfigDraftType,
    AgentConfigRevisionOperation,
    AgentIconType,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentBindingType,
)
from models.agent_config_entities import (
    AgentCliToolConfig,
    AgentHumanContactConfig,
    AgentKnowledgeDatasetConfig,
    AgentSoulConfig,
    DeclaredOutputConfig,
    DeclaredOutputType,
    WorkflowNodeJobConfig,
    WorkflowPreviousNodeOutputRef,
)
from services.entities.agent_entities import (
    ComposerCandidateCapabilities,
    ComposerSaveStrategy,
    ComposerVariant,
)


class AgentConfigSnapshotSummaryResponse(ResponseModel):
    id: str
    agent_id: str | None = None
    # User-facing version number among visible published versions.
    version: int
    # Alias for the user-facing version number; kept explicit for clients that
    # want to distinguish it from the immutable snapshot sequence.
    display_version: int | None = None
    # Immutable snapshot sequence number used internally for audit/history.
    snapshot_version: int | None = None
    summary: str | None = None
    version_note: str | None = None
    created_by: str | None = None
    created_at: int | None = None


class AgentConfigDraftSummaryResponse(ResponseModel):
    id: str
    agent_id: str
    draft_type: AgentConfigDraftType
    account_id: str | None = None
    base_snapshot_id: str | None = None
    created_by: str | None = None
    updated_by: str | None = None
    created_at: int | None = None
    updated_at: int | None = None


class AgentPublishedReferenceResponse(ResponseModel):
    app_id: str
    app_name: str
    app_icon_type: str | None = None
    app_icon: str | None = None
    app_icon_background: str | None = None
    app_mode: str
    app_updated_at: int | None = None
    workflow_id: str
    workflow_version: str
    node_ids: list[str] = Field(default_factory=list)


class AgentRosterResponse(ResponseModel):
    id: str
    name: str
    description: str
    role: str = ""
    icon_type: AgentIconType | None = None
    icon: str | None = None
    icon_background: str | None = None
    agent_kind: AgentKind
    scope: AgentScope
    source: AgentSource
    app_id: str | None = None
    backing_app_id: str | None = None
    hidden_app_backed: bool = False
    workflow_id: str | None = None
    workflow_node_id: str | None = None
    active_config_snapshot_id: str | None = None
    active_config_snapshot: AgentConfigSnapshotSummaryResponse | None = None
    active_config_is_published: bool = False
    status: AgentStatus
    created_by: str | None = None
    updated_by: str | None = None
    archived_by: str | None = None
    archived_at: int | None = None
    created_at: int | None = None
    updated_at: int | None = None
    published_reference_count: int = 0
    published_node_reference_count: int = 0
    published_references: list[AgentPublishedReferenceResponse] = Field(default_factory=list)


class AgentInviteOptionResponse(AgentRosterResponse):
    is_in_current_workflow: bool = False
    in_current_workflow_count: int = 0
    existing_node_ids: list[str] = Field(default_factory=list)


class AgentRosterListResponse(ResponseModel):
    data: list[AgentRosterResponse]
    page: int
    limit: int
    total: int
    has_more: bool


class AgentInviteOptionsResponse(ResponseModel):
    data: list[AgentInviteOptionResponse]
    page: int
    limit: int
    total: int
    has_more: bool


class AgentLogSourceResponse(ResponseModel):
    id: str
    type: Literal["webapp", "workflow"]
    app_id: str
    app_name: str
    app_icon_type: str | None = None
    app_icon: str | None = None
    app_icon_background: str | None = None
    workflow_id: str | None = None
    workflow_version: str | None = None
    node_id: str | None = None


class AgentLogSourceGroupResponse(ResponseModel):
    type: Literal["webapp", "workflow"]
    label: str
    sources: list[AgentLogSourceResponse] = Field(default_factory=list)


class AgentLogSourceListResponse(ResponseModel):
    data: list[AgentLogSourceResponse]
    groups: list[AgentLogSourceGroupResponse]


class AgentLogConversationItemResponse(ResponseModel):
    id: str
    conversation_id: str
    title: str | None = None
    end_user_id: str | None = None
    message_count: int
    user_rate: float | None = None
    operation_rate: float | None = None
    unread: bool
    source: AgentLogSourceResponse | None = None
    status: Literal["success", "failed", "paused"]
    created_at: int | None = None
    updated_at: int | None = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class AgentLogMessageItemResponse(ResponseModel):
    id: str
    message_id: str
    conversation_id: str
    query: str
    answer: str
    status: str
    error: str | None = None
    from_end_user_id: str | None = None
    from_account_id: str | None = None
    message_tokens: int
    answer_tokens: int
    total_tokens: int
    total_price: str
    currency: str
    latency: float
    created_at: int | None = None
    updated_at: int | None = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class AgentLogListResponse(ResponseModel):
    data: list[AgentLogConversationItemResponse]
    page: int
    limit: int
    total: int
    has_more: bool


class AgentLogMessageListResponse(ResponseModel):
    data: list[AgentLogMessageItemResponse]
    page: int
    limit: int
    total: int
    has_more: bool


class AgentStatisticSummaryResponse(ResponseModel):
    total_messages: int
    total_conversations: int
    total_end_users: int
    total_tokens: int
    total_price: str
    currency: str
    average_session_interactions: float
    average_response_time: float
    tokens_per_second: float
    user_satisfaction_rate: float


class AgentDailyMessageStatisticResponse(ResponseModel):
    date: str
    message_count: int


class AgentDailyConversationStatisticResponse(ResponseModel):
    date: str
    conversation_count: int


class AgentDailyEndUserStatisticResponse(ResponseModel):
    date: str
    terminal_count: int


class AgentTokenUsageStatisticResponse(ResponseModel):
    date: str
    token_count: int
    total_price: str
    currency: str


class AgentAverageSessionInteractionStatisticResponse(ResponseModel):
    date: str
    interactions: float


class AgentAverageResponseTimeStatisticResponse(ResponseModel):
    date: str
    latency: float


class AgentTokensPerSecondStatisticResponse(ResponseModel):
    date: str
    tps: float


class AgentUserSatisfactionRateStatisticResponse(ResponseModel):
    date: str
    rate: float


class AgentStatisticChartsResponse(ResponseModel):
    daily_messages: list[AgentDailyMessageStatisticResponse] = Field(default_factory=list)
    daily_conversations: list[AgentDailyConversationStatisticResponse] = Field(default_factory=list)
    daily_end_users: list[AgentDailyEndUserStatisticResponse] = Field(default_factory=list)
    token_usage: list[AgentTokenUsageStatisticResponse] = Field(default_factory=list)
    average_session_interactions: list[AgentAverageSessionInteractionStatisticResponse] = Field(default_factory=list)
    average_response_time: list[AgentAverageResponseTimeStatisticResponse] = Field(default_factory=list)
    tokens_per_second: list[AgentTokensPerSecondStatisticResponse] = Field(default_factory=list)
    user_satisfaction_rate: list[AgentUserSatisfactionRateStatisticResponse] = Field(default_factory=list)


class AgentStatisticSummaryEnvelopeResponse(ResponseModel):
    source: str
    summary: AgentStatisticSummaryResponse
    charts: AgentStatisticChartsResponse


class AgentConfigRevisionResponse(ResponseModel):
    id: str
    previous_snapshot_id: str | None = None
    current_snapshot_id: str
    revision: int
    operation: AgentConfigRevisionOperation
    summary: str | None = None
    version_note: str | None = None
    created_by: str | None = None
    created_at: int | None = None


class AgentConfigSnapshotDetailResponse(AgentConfigSnapshotSummaryResponse):
    config_snapshot: AgentSoulConfig
    revisions: list[AgentConfigRevisionResponse] = Field(default_factory=list)


class AgentConfigSnapshotListResponse(ResponseModel):
    data: list[AgentConfigSnapshotSummaryResponse]


class AgentConfigSnapshotRestoreResponse(ResponseModel):
    result: Literal["success"]
    active_config_snapshot_id: str
    draft_config_id: str | None = None
    restored_version_id: str | None = None


class AgentComposerAgentResponse(ResponseModel):
    id: str
    name: str
    description: str
    role: str | None = None
    icon_type: str | None = None
    icon: str | None = None
    icon_background: str | None = None
    scope: AgentScope
    source: AgentSource | None = None
    status: AgentStatus
    app_id: str | None = None
    backing_app_id: str | None = None
    hidden_app_backed: bool = False
    active_config_snapshot_id: str | None = None


class AgentComposerBindingResponse(ResponseModel):
    id: str
    binding_type: WorkflowAgentBindingType
    agent_id: str | None = None
    current_snapshot_id: str | None = None
    workflow_id: str
    node_id: str


class AgentComposerSoulLockResponse(ResponseModel):
    locked: bool
    can_unlock: bool = False
    reason: str | None = None


class AgentComposerImpactBindingResponse(ResponseModel):
    app_id: str
    workflow_id: str
    node_id: str


class AgentComposerImpactResponse(ResponseModel):
    current_snapshot_id: str | None = None
    workflow_node_count: int
    bindings: list[AgentComposerImpactBindingResponse] = Field(default_factory=list)


class WorkflowAgentComposerResponse(ResponseModel):
    variant: Literal[ComposerVariant.WORKFLOW]
    agent: AgentComposerAgentResponse | None = None
    active_config_snapshot: AgentConfigSnapshotSummaryResponse | None = None
    binding: AgentComposerBindingResponse | None = None
    soul_lock: AgentComposerSoulLockResponse
    agent_soul: AgentSoulConfig
    node_job: WorkflowNodeJobConfig
    effective_declared_outputs: list[DeclaredOutputConfig] = Field(default_factory=list)
    save_options: list[ComposerSaveStrategy]
    impact_summary: AgentComposerImpactResponse | None = None
    validation: "ComposerValidationFindingsResponse | None" = None
    app_id: str | None = None
    backing_app_id: str | None = None
    hidden_app_backed: bool = False
    chat_endpoint: str | None = None
    workflow_id: str | None = None
    node_id: str | None = None


class AgentAppComposerResponse(ResponseModel):
    variant: Literal[ComposerVariant.AGENT_APP]
    agent: AgentComposerAgentResponse
    active_config_snapshot: AgentConfigSnapshotSummaryResponse | None = None
    draft: AgentConfigDraftSummaryResponse | None = None
    agent_soul: AgentSoulConfig
    save_options: list[ComposerSaveStrategy]
    validation: "ComposerValidationFindingsResponse | None" = None
    app_id: str | None = None
    backing_app_id: str | None = None
    hidden_app_backed: bool = False
    chat_endpoint: str | None = None


class ComposerValidationWarningResponse(ResponseModel):
    code: str
    surface: str | None = None
    kind: str | None = None
    id: str | None = None
    message: str | None = None


class ComposerKnowledgePlaceholderResponse(ResponseModel):
    id: str
    placeholder_name: str


class ComposerValidationFindingsResponse(ResponseModel):
    warnings: list[ComposerValidationWarningResponse] = Field(default_factory=list)
    knowledge_retrieval_placeholder: list[ComposerKnowledgePlaceholderResponse] = Field(default_factory=list)


class AgentComposerValidateResponse(ResponseModel):
    result: Literal["success"]
    errors: list[str] = Field(default_factory=list)
    warnings: list[ComposerValidationWarningResponse] = Field(default_factory=list)
    knowledge_retrieval_placeholder: list[ComposerKnowledgePlaceholderResponse] = Field(default_factory=list)


class AgentComposerDifyToolCandidateResponse(ResponseModel):
    id: str | None = None
    # "provider" = the whole provider (all of its tools, id "<provider>/*");
    # "tool" = one tool (id "<provider>/<tool_name>"). See ENG-616.
    granularity: str | None = None
    name: str | None = None
    description: str | None = None
    provider: str | None = None
    provider_id: str | None = None
    plugin_id: str | None = None
    tools_count: int | None = None


class AgentComposerNodeJobCandidatesResponse(ResponseModel):
    previous_node_outputs: list[WorkflowPreviousNodeOutputRef] = Field(default_factory=list)
    declare_output_types: list[DeclaredOutputType] = Field(default_factory=list)
    human_contacts: list[AgentHumanContactConfig] = Field(default_factory=list)


class AgentComposerKnowledgeDatasetCandidateResponse(AgentKnowledgeDatasetConfig):
    missing: bool = False


class AgentComposerKnowledgeSetCandidateResponse(ResponseModel):
    id: str
    name: str
    description: str | None = None
    datasets: list[AgentComposerKnowledgeDatasetCandidateResponse] = Field(default_factory=list)
    missing_dataset_ids: list[str] = Field(default_factory=list)


class AgentComposerSoulCandidatesResponse(ResponseModel):
    dify_tools: list[AgentComposerDifyToolCandidateResponse] = Field(default_factory=list)
    cli_tools: list[AgentCliToolConfig] = Field(default_factory=list)
    knowledge_sets: list[AgentComposerKnowledgeSetCandidateResponse] = Field(default_factory=list)
    human_contacts: list[AgentHumanContactConfig] = Field(default_factory=list)


class AgentComposerCandidatesResponse(ResponseModel):
    variant: ComposerVariant
    allowed_node_job_candidates: AgentComposerNodeJobCandidatesResponse = Field(
        default_factory=AgentComposerNodeJobCandidatesResponse
    )
    allowed_soul_candidates: AgentComposerSoulCandidatesResponse = Field(
        default_factory=AgentComposerSoulCandidatesResponse
    )
    capabilities: ComposerCandidateCapabilities = Field(default_factory=ComposerCandidateCapabilities)
    truncated: bool = False
