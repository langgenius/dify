from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


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


class AgentSoulModelCredentialRef(BaseModel):
    """Reference to model credentials resolved only at runtime."""

    type: str = Field(min_length=1, max_length=64)
    id: str | None = Field(default=None, max_length=255)
    provider: str | None = Field(default=None, max_length=255)


class AgentSoulModelConfig(BaseModel):
    """Stable model selection for Agent runtime without storing secret values."""

    plugin_id: str = Field(min_length=1, max_length=255)
    model_provider: str = Field(min_length=1, max_length=255)
    model: str = Field(min_length=1, max_length=255)
    credential_ref: AgentSoulModelCredentialRef | None = None
    model_settings: dict[str, Any] = Field(default_factory=dict)


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
    model: AgentSoulModelConfig | None = None
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
