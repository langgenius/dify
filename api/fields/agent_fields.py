from typing import Any, Literal

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
    AgentSoulConfig,
    DeclaredOutputConfig,
    DeclaredOutputType,
    WorkflowNodeJobConfig,
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
    created_at: str | None = None


class AgentRosterResponse(ResponseModel):
    id: str
    name: str
    description: str
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
    status: AgentStatus
    created_by: str | None = None
    updated_by: str | None = None
    archived_by: str | None = None
    archived_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


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
    created_at: str | None = None


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
    app_id: str | None = None
    workflow_id: str | None = None
    node_id: str | None = None


class AgentAppComposerResponse(ResponseModel):
    variant: Literal[ComposerVariant.AGENT_APP]
    agent: AgentComposerAgentResponse
    active_config_snapshot: AgentConfigSnapshotSummaryResponse
    agent_soul: AgentSoulConfig
    save_options: list[ComposerSaveStrategy]


class AgentComposerValidateResponse(ResponseModel):
    result: Literal["success"]
    errors: list[str] = Field(default_factory=list)


class AgentComposerNodeJobCandidatesResponse(ResponseModel):
    previous_node_outputs: list[dict[str, Any]] = Field(default_factory=list)
    declare_output_types: list[DeclaredOutputType] = Field(default_factory=list)
    human_contacts: list[dict[str, Any]] = Field(default_factory=list)


class AgentComposerSoulCandidatesResponse(ResponseModel):
    skills_files: list[dict[str, Any]] = Field(default_factory=list)
    dify_tools: list[dict[str, Any]] = Field(default_factory=list)
    cli_tools: list[dict[str, Any]] = Field(default_factory=list)
    knowledge_datasets: list[dict[str, Any]] = Field(default_factory=list)
    human_contacts: list[dict[str, Any]] = Field(default_factory=list)


class AgentComposerCandidatesResponse(ResponseModel):
    variant: ComposerVariant
    allowed_node_job_candidates: AgentComposerNodeJobCandidatesResponse = Field(
        default_factory=AgentComposerNodeJobCandidatesResponse
    )
    allowed_soul_candidates: AgentComposerSoulCandidatesResponse = Field(
        default_factory=AgentComposerSoulCandidatesResponse
    )
    capabilities: ComposerCandidateCapabilities = Field(default_factory=ComposerCandidateCapabilities)
