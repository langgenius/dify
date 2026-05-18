from __future__ import annotations

from collections.abc import Mapping
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator, model_validator

CONTRACT_VERSION = "agent-backend.v1"


class AgentInvokeFrom(StrEnum):
    WORKFLOW_RUN = "workflow_run"
    SINGLE_STEP = "single_step"
    AGENT_APP = "agent_app"
    BABYSIT = "babysit"
    FASTEN = "fasten"


class AgentLayerType(StrEnum):
    WORKFLOW_CONTEXT = "workflow_context"
    PROMPT = "prompt"
    FILESYSTEM = "filesystem"
    SANDBOX = "sandbox"
    DIFY_PLUGIN_TOOLS = "dify_plugin_tools"
    CLI_TOOLS = "cli_tools"
    SKILLS = "skills"
    HUMAN_CONTACTS = "human_contacts"
    OUTPUT_SCHEMA = "output_schema"
    MEMORY = "memory"
    SECRETS = "secrets"


class LayerLifecycleScope(StrEnum):
    INVOCATION = "invocation"
    WORKFLOW_RUN = "workflow_run"
    AGENT_SESSION = "agent_session"
    PERSISTENT_REF = "persistent_ref"


class PromptOrigin(StrEnum):
    AGENT_SOUL = "agent_soul"
    WORKFLOW_NODE_JOB = "workflow_node_job"
    BABYSIT_TRANSIENT = "babysit_transient"
    FASTEN_CANDIDATE = "fasten_candidate"


class PromptRole(StrEnum):
    SYSTEM = "system"
    USER = "user"
    DEVELOPER = "developer"


class AgentIdentityKind(StrEnum):
    ROSTER_AGENT = "roster_agent"
    WORKFLOW_INLINE_AGENT = "workflow_inline_agent"
    AGENT_APP = "agent_app"


class ReferenceType(StrEnum):
    AGENT = "agent"
    AGENT_CONFIG_VERSION = "agent_config_version"
    CREDENTIAL = "credential"
    FILE = "file"
    HUMAN = "human"
    MEMORY = "memory"
    SECRET = "secret"
    SKILL = "skill"
    TOOL = "tool"
    WORKFLOW = "workflow"
    WORKFLOW_RUN = "workflow_run"


class AgentBackendBaseModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True, use_enum_values=True)

    def model_dump(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        kwargs.setdefault("by_alias", True)
        return super().model_dump(*args, **kwargs)

    def model_dump_redacted(self, **kwargs: Any) -> dict[str, Any]:
        dumped = self.model_dump(mode="json", **kwargs)
        return _redact_mapping(dumped)


class AgentExecutionContext(AgentBackendBaseModel):
    tenant_id: str
    app_id: str | None = None
    workflow_id: str | None = None
    workflow_run_id: str | None = None
    node_id: str | None = None
    node_execution_id: str | None = None
    conversation_id: str | None = None
    agent_id: str | None = None
    agent_config_version_id: str | None = None
    invoke_from: AgentInvokeFrom
    trace_id: str | None = None


class ResourceRef(AgentBackendBaseModel):
    type: ReferenceType
    id: str
    name: str | None = None
    metadata: Mapping[str, JsonValue] = Field(default_factory=dict)


class AgentIdentityRef(AgentBackendBaseModel):
    kind: AgentIdentityKind
    agent_ref: ResourceRef | None = None
    config_version_ref: ResourceRef | None = None


class AgentRuntimeOptions(AgentBackendBaseModel):
    stream: bool = True
    timeout_seconds: float | None = None
    debug: bool = False
    mock_scenario: str | None = None


class BaseAgentLayerConfig(AgentBackendBaseModel):
    id: str
    lifecycle_scope: LayerLifecycleScope = LayerLifecycleScope.INVOCATION
    depends_on: list[str] = Field(default_factory=list)


class WorkflowContextLayerConfig(BaseAgentLayerConfig):
    type: Literal[AgentLayerType.WORKFLOW_CONTEXT] = AgentLayerType.WORKFLOW_CONTEXT
    workflow_ref: ResourceRef | None = None
    workflow_run_ref: ResourceRef | None = None
    node_id: str | None = None
    node_execution_id: str | None = None
    variables: Mapping[str, JsonValue] = Field(default_factory=dict)
    previous_node_outputs: Mapping[str, JsonValue] = Field(default_factory=dict)


class PromptLayerConfig(BaseAgentLayerConfig):
    type: Literal[AgentLayerType.PROMPT] = AgentLayerType.PROMPT
    origin: PromptOrigin
    role: PromptRole
    content: str


class FilesystemMountConfig(AgentBackendBaseModel):
    ref: ResourceRef
    mount_point: str
    read_only: bool = False


class FilesystemLayerConfig(BaseAgentLayerConfig):
    type: Literal[AgentLayerType.FILESYSTEM] = AgentLayerType.FILESYSTEM
    mounts: list[FilesystemMountConfig] = Field(default_factory=list)


class SandboxLayerConfig(BaseAgentLayerConfig):
    type: Literal[AgentLayerType.SANDBOX] = AgentLayerType.SANDBOX
    provider: str
    image: str | None = None
    options: Mapping[str, JsonValue] = Field(default_factory=dict)


class DifyPluginToolRef(AgentBackendBaseModel):
    tool_ref: ResourceRef
    credential_ref: ResourceRef | None = None
    runtime_parameters: Mapping[str, JsonValue] = Field(default_factory=dict)


class DifyPluginToolsLayerConfig(BaseAgentLayerConfig):
    type: Literal[AgentLayerType.DIFY_PLUGIN_TOOLS] = AgentLayerType.DIFY_PLUGIN_TOOLS
    tools: list[DifyPluginToolRef] = Field(default_factory=list)


class CliToolRef(AgentBackendBaseModel):
    name: str
    command: str
    install_command: str | None = None
    credential_ref: ResourceRef | None = None
    metadata: Mapping[str, JsonValue] = Field(default_factory=dict)


class CliToolsLayerConfig(BaseAgentLayerConfig):
    type: Literal[AgentLayerType.CLI_TOOLS] = AgentLayerType.CLI_TOOLS
    tools: list[CliToolRef] = Field(default_factory=list)


class SkillsLayerConfig(BaseAgentLayerConfig):
    type: Literal[AgentLayerType.SKILLS] = AgentLayerType.SKILLS
    skill_refs: list[ResourceRef] = Field(default_factory=list)


class HumanContactRef(AgentBackendBaseModel):
    human_ref: ResourceRef
    allowed_delivery_methods: list[str] = Field(default_factory=list)


class HumanContactsLayerConfig(BaseAgentLayerConfig):
    type: Literal[AgentLayerType.HUMAN_CONTACTS] = AgentLayerType.HUMAN_CONTACTS
    contacts: list[HumanContactRef] = Field(default_factory=list)


class OutputDeclaration(AgentBackendBaseModel):
    name: str
    type: str
    json_schema: Mapping[str, JsonValue] | None = Field(default=None, alias="schema")
    required: bool = True
    validation_prompt: str | None = None
    benchmark_file_ref: ResourceRef | None = None


class OutputSchemaLayerConfig(BaseAgentLayerConfig):
    type: Literal[AgentLayerType.OUTPUT_SCHEMA] = AgentLayerType.OUTPUT_SCHEMA
    outputs: list[OutputDeclaration] = Field(default_factory=list)


class MemoryLayerConfig(BaseAgentLayerConfig):
    type: Literal[AgentLayerType.MEMORY] = AgentLayerType.MEMORY
    strategy_ref: ResourceRef | None = None
    scope: str | None = None
    options: Mapping[str, JsonValue] = Field(default_factory=dict)


class SecretBinding(AgentBackendBaseModel):
    secret_ref: ResourceRef
    env_name: str
    required: bool = True

    @field_validator("secret_ref")
    @classmethod
    def validate_secret_ref(cls, value: ResourceRef) -> ResourceRef:
        if value.type != ReferenceType.SECRET:
            raise ValueError("secret_ref must reference a secret")
        return value


class SecretsLayerConfig(BaseAgentLayerConfig):
    type: Literal[AgentLayerType.SECRETS] = AgentLayerType.SECRETS
    bindings: list[SecretBinding] = Field(default_factory=list)


type AgentLayerConfig = Annotated[
    WorkflowContextLayerConfig
    | PromptLayerConfig
    | FilesystemLayerConfig
    | SandboxLayerConfig
    | DifyPluginToolsLayerConfig
    | CliToolsLayerConfig
    | SkillsLayerConfig
    | HumanContactsLayerConfig
    | OutputSchemaLayerConfig
    | MemoryLayerConfig
    | SecretsLayerConfig,
    Field(discriminator="type"),
]


class CompositorConfig(AgentBackendBaseModel):
    contract_version: Literal["agent-backend.v1"] = CONTRACT_VERSION
    execution_context: AgentExecutionContext
    agent_identity: AgentIdentityRef | None = None
    layers: list[AgentLayerConfig]
    runtime_options: AgentRuntimeOptions = Field(default_factory=AgentRuntimeOptions)

    @model_validator(mode="after")
    def validate_contract(self) -> CompositorConfig:
        layer_ids = [layer.id for layer in self.layers]
        if len(layer_ids) != len(set(layer_ids)):
            raise ValueError("layer ids must be unique")
        known_ids = set(layer_ids)
        for layer in self.layers:
            unknown_deps = set(layer.depends_on) - known_ids
            if unknown_deps:
                raise ValueError(f"layer '{layer.id}' depends on unknown layer ids: {sorted(unknown_deps)}")
        return self


_SENSITIVE_KEY_PARTS = ("secret", "credential", "token", "password", "api_key")


def _redact_mapping(value: Any) -> Any:
    if isinstance(value, Mapping):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key).lower()
            if any(part in key_text for part in _SENSITIVE_KEY_PARTS):
                redacted[key] = "[REDACTED]"
            else:
                redacted[key] = _redact_mapping(item)
        return redacted
    if isinstance(value, list):
        return [_redact_mapping(item) for item in value]
    return value
