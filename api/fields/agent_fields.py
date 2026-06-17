from typing import Annotated, Literal

from pydantic import Field

from fields.base import ResponseModel
from models.agent import (
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
    AgentFileRefConfig,
    AgentHumanContactConfig,
    AgentKnowledgeDatasetConfig,
    AgentSkillRefConfig,
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
    version: int
    summary: str | None = None
    version_note: str | None = None
    created_by: str | None = None
    created_at: int | None = None


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


class AgentComposerAgentResponse(ResponseModel):
    id: str
    name: str
    description: str
    scope: AgentScope
    status: AgentStatus
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
    workflow_id: str | None = None
    node_id: str | None = None


class AgentAppComposerResponse(ResponseModel):
    variant: Literal[ComposerVariant.AGENT_APP]
    agent: AgentComposerAgentResponse
    active_config_snapshot: AgentConfigSnapshotSummaryResponse
    agent_soul: AgentSoulConfig
    save_options: list[ComposerSaveStrategy]
    validation: "ComposerValidationFindingsResponse | None" = None


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


class AgentComposerSkillCandidateResponse(AgentSkillRefConfig):
    kind: Literal["skill"] = "skill"


class AgentComposerFileCandidateResponse(AgentFileRefConfig):
    kind: Literal["file"] = "file"


AgentComposerSkillFileCandidateResponse = Annotated[
    AgentComposerSkillCandidateResponse | AgentComposerFileCandidateResponse,
    Field(discriminator="kind"),
]


class AgentComposerNodeJobCandidatesResponse(ResponseModel):
    previous_node_outputs: list[WorkflowPreviousNodeOutputRef] = Field(default_factory=list)
    declare_output_types: list[DeclaredOutputType] = Field(default_factory=list)
    human_contacts: list[AgentHumanContactConfig] = Field(default_factory=list)


class AgentComposerSoulCandidatesResponse(ResponseModel):
    skills_files: list[AgentComposerSkillFileCandidateResponse] = Field(default_factory=list)
    dify_tools: list[AgentComposerDifyToolCandidateResponse] = Field(default_factory=list)
    cli_tools: list[AgentCliToolConfig] = Field(default_factory=list)
    knowledge_datasets: list[AgentKnowledgeDatasetConfig] = Field(default_factory=list)
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
