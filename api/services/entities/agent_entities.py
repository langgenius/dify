from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from models.agent import AgentIconType


class ComposerVariant(StrEnum):
    WORKFLOW = "workflow"
    AGENT_APP = "agent_app"


class ComposerSaveStrategy(StrEnum):
    NODE_JOB_ONLY = "node_job_only"
    SAVE_TO_CURRENT_VERSION = "save_to_current_version"
    SAVE_AS_NEW_VERSION = "save_as_new_version"
    SAVE_AS_NEW_AGENT = "save_as_new_agent"
    SAVE_TO_ROSTER = "save_to_roster"


class AgentKnowledgeQueryMode(StrEnum):
    USER_QUERY = "user_query"
    GENERATED_QUERY = "generated_query"


class WorkflowNodeJobMode(StrEnum):
    LET_AGENT_FIGURE_IT_OUT = "let_agent_figure_it_out"
    TELL_AGENT_WHAT_TO_DO = "tell_agent_what_to_do"


class DeclaredOutputType(StrEnum):
    STRING = "string"
    NUMBER = "number"
    OBJECT = "object"
    ARRAY = "array"
    BOOLEAN = "boolean"
    FILE = "file"


class AgentSoulPromptConfig(BaseModel):
    system_prompt: str = ""


class AgentSoulSkillsFilesConfig(BaseModel):
    files: list[dict[str, Any]] = Field(default_factory=list)
    skills: list[dict[str, Any]] = Field(default_factory=list)


class AgentSoulToolsConfig(BaseModel):
    dify_tools: list[dict[str, Any]] = Field(default_factory=list)
    cli_tools: list[dict[str, Any]] = Field(default_factory=list)


class AgentSoulKnowledgeConfig(BaseModel):
    datasets: list[dict[str, Any]] = Field(default_factory=list)
    query_mode: AgentKnowledgeQueryMode | None = None
    query_config: dict[str, Any] = Field(default_factory=dict)


class AgentSoulHumanConfig(BaseModel):
    contacts: list[dict[str, Any]] = Field(default_factory=list)
    tools: list[dict[str, Any]] = Field(default_factory=list)


class AgentSoulEnvConfig(BaseModel):
    variables: list[dict[str, Any]] = Field(default_factory=list)
    secret_refs: list[dict[str, Any]] = Field(default_factory=list)


class AgentSoulSandboxConfig(BaseModel):
    provider: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)


class AgentSoulMemoryConfig(BaseModel):
    scope: str | None = None
    budget: str | None = None
    artifacts: list[dict[str, Any]] = Field(default_factory=list)


class AppVariableConfig(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    type: str = Field(min_length=1, max_length=64)
    required: bool = False
    default: Any = None


class AgentSoulConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = 1
    prompt: AgentSoulPromptConfig = Field(default_factory=AgentSoulPromptConfig)
    skills_files: AgentSoulSkillsFilesConfig = Field(default_factory=AgentSoulSkillsFilesConfig)
    tools: AgentSoulToolsConfig = Field(default_factory=AgentSoulToolsConfig)
    knowledge: AgentSoulKnowledgeConfig = Field(default_factory=AgentSoulKnowledgeConfig)
    human: AgentSoulHumanConfig = Field(default_factory=AgentSoulHumanConfig)
    env: AgentSoulEnvConfig = Field(default_factory=AgentSoulEnvConfig)
    sandbox: AgentSoulSandboxConfig = Field(default_factory=AgentSoulSandboxConfig)
    memory: AgentSoulMemoryConfig = Field(default_factory=AgentSoulMemoryConfig)
    app_features: dict[str, Any] = Field(default_factory=dict)
    app_variables: list[AppVariableConfig] = Field(default_factory=list)
    misc_legacy: dict[str, Any] = Field(default_factory=dict)


class DeclaredOutputFileConfig(BaseModel):
    extensions: list[str] = Field(default_factory=list)
    mime_types: list[str] = Field(default_factory=list)


class DeclaredOutputCheckConfig(BaseModel):
    type: str = Field(min_length=1, max_length=64)
    prompt: str | None = None
    benchmark_file_ref: dict[str, Any] | None = None


class DeclaredOutputFailureStrategy(BaseModel):
    on_type_check_failed: str | None = None
    on_output_check_failed: str | None = None
    max_retries: int = Field(default=0, ge=0, le=10)


class DeclaredOutputConfig(BaseModel):
    id: str | None = None
    name: str = Field(min_length=1, max_length=255)
    type: DeclaredOutputType
    description: str | None = None
    required: bool = True
    file: DeclaredOutputFileConfig | None = None
    checks: list[DeclaredOutputCheckConfig] = Field(default_factory=list)
    failure_strategy: DeclaredOutputFailureStrategy | None = None

    @model_validator(mode="after")
    def validate_file_metadata(self) -> "DeclaredOutputConfig":
        if self.type == DeclaredOutputType.FILE and self.file is None:
            self.file = DeclaredOutputFileConfig()
        if self.type != DeclaredOutputType.FILE and self.file is not None:
            raise ValueError("file metadata is only allowed for file outputs")
        return self


class WorkflowNodeJobConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = 1
    mode: WorkflowNodeJobMode = WorkflowNodeJobMode.TELL_AGENT_WHAT_TO_DO
    workflow_prompt: str = ""
    previous_node_output_refs: list[dict[str, Any]] = Field(default_factory=list)
    declared_outputs: list[DeclaredOutputConfig] = Field(default_factory=list)
    human_contacts: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ComposerBindingPayload(BaseModel):
    binding_type: Literal["roster_agent", "inline_agent"]
    agent_id: str | None = None
    current_snapshot_id: str | None = None


class ComposerSoulLockPayload(BaseModel):
    locked: bool = True
    unlocked_from_version_id: str | None = None


class ComposerSavePayload(BaseModel):
    variant: ComposerVariant
    binding: ComposerBindingPayload | None = None
    soul_lock: ComposerSoulLockPayload = Field(default_factory=ComposerSoulLockPayload)
    agent_soul: AgentSoulConfig | None = None
    node_job: WorkflowNodeJobConfig | None = None
    save_strategy: ComposerSaveStrategy
    version_note: str | None = None
    idempotency_key: str | None = None
    client_revision_id: str | None = None
    new_agent_name: str | None = Field(default=None, min_length=1, max_length=255)

    @model_validator(mode="after")
    def validate_variant_sections(self) -> "ComposerSavePayload":
        if self.variant == ComposerVariant.AGENT_APP and self.node_job is not None:
            raise ValueError("Agent App Variant must not include workflow node job config")
        if self.variant == ComposerVariant.AGENT_APP and self.agent_soul is not None:
            if self.agent_soul.app_variables and self.save_strategy == ComposerSaveStrategy.NODE_JOB_ONLY:
                raise ValueError("Agent App Variant cannot use node_job_only save strategy")
        if self.variant == ComposerVariant.WORKFLOW and self.agent_soul is not None:
            if self.agent_soul.app_variables:
                raise ValueError("Workflow Variant must not include app variables")
            if self.agent_soul.app_features:
                raise ValueError("Workflow Variant must not include app features")
        return self


class RosterAgentCreatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = ""
    icon_type: AgentIconType | None = None
    icon: str | None = Field(default=None, max_length=255)
    icon_background: str | None = Field(default=None, max_length=255)
    agent_soul: AgentSoulConfig = Field(default_factory=AgentSoulConfig)
    version_note: str | None = None


class RosterAgentUpdatePayload(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    icon_type: AgentIconType | None = None
    icon: str | None = Field(default=None, max_length=255)
    icon_background: str | None = Field(default=None, max_length=255)


class RosterListQuery(BaseModel):
    page: int = Field(default=1, ge=1)
    limit: int = Field(default=20, ge=1, le=100)
    keyword: str | None = None


class ComposerCandidateCapabilities(BaseModel):
    human_roster_available: bool = False


class ComposerCandidatesResponse(BaseModel):
    variant: ComposerVariant
    allowed_node_job_candidates: dict[str, Any] = Field(default_factory=dict)
    allowed_soul_candidates: dict[str, Any] = Field(default_factory=dict)
    capabilities: ComposerCandidateCapabilities = Field(default_factory=ComposerCandidateCapabilities)
