import re
from enum import StrEnum
from typing import Any, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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


class OutputErrorStrategy(StrEnum):
    """Per-output failure handling strategy.

    Mirrors ``graphon.ErrorStrategy`` but scoped to a single declared output of
    a Workflow Agent Node. The runtime applies the strategy after type check or
    output check fails and any configured retry attempts have been exhausted.
    """

    STOP = "stop"
    DEFAULT_VALUE = "default_value"
    FAIL_BRANCH = "fail_branch"


# JSON-schema-friendly name pattern. Stage 4 §3.1 / §10.1.
_OUTPUT_NAME_PATTERN: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class AgentSoulPromptConfig(BaseModel):
    system_prompt: str = ""


class AgentSoulSkillsFilesConfig(BaseModel):
    files: list[dict[str, Any]] = Field(default_factory=list)
    skills: list[dict[str, Any]] = Field(default_factory=list)


class AgentSoulDifyToolCredentialRef(BaseModel):
    """Reference to a stored Dify Plugin Tool credential.

    Secret values are resolved only at runtime. The legacy ``credential_id``
    field is accepted by :class:`AgentSoulDifyToolConfig` and normalized here so
    old Agent tool payloads can be read while new payloads stay explicit.
    """

    model_config = ConfigDict(extra="ignore")

    type: Literal["provider", "tool"] = "tool"
    id: str | None = Field(default=None, max_length=255)
    provider: str | None = Field(default=None, max_length=255)


class AgentSoulDifyToolConfig(BaseModel):
    """One Dify Plugin Tool configured on Agent Soul.

    The API backend prepares this persisted product shape into
    ``DifyPluginToolConfig`` before sending a run request to Agent backend.
    ``provider_id`` keeps compatibility with existing Agent tool config payloads;
    new callers should send ``plugin_id`` + ``provider`` when available.
    """

    # ``extra="ignore"`` (not ``"allow"``) so historical Agent Soul payloads
    # with unknown fields still load — but the extra keys are dropped instead
    # of silently riding along into ``model_dump``. New callers should send the
    # explicit schema fields below.
    model_config = ConfigDict(extra="ignore")

    enabled: bool = True
    # Dify Plugin Tools live behind the ``PLUGIN`` provider type. ``BUILT_IN`` /
    # ``WORKFLOW`` / ``API`` providers are not exposed to the Agent backend in
    # this layer — keep the default narrow so a missing field surfaces as
    # ``agent_tool_declaration_not_found`` against the correct provider table.
    provider_type: str = "plugin"
    provider_id: str | None = Field(default=None, max_length=255)
    plugin_id: str | None = Field(default=None, max_length=255)
    provider: str | None = Field(default=None, max_length=255)
    tool_name: str = Field(min_length=1, max_length=255)
    credential_type: Literal["api-key", "oauth2", "unauthorized"] = "api-key"
    credential_ref: AgentSoulDifyToolCredentialRef | None = None
    # Reserved for a future user-rename UX. Accepted but currently rejected at
    # validation time so frontend cannot silently believe a rename took effect
    # (see :meth:`_validate_provider_and_credentials`).
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    runtime_parameters: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def _normalize_legacy_payload(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        normalized = dict(value)
        if normalized.get("provider_id") is None and isinstance(normalized.get("provider_name"), str):
            normalized["provider_id"] = normalized["provider_name"]
        if normalized.get("runtime_parameters") is None and isinstance(normalized.get("tool_parameters"), dict):
            normalized["runtime_parameters"] = normalized["tool_parameters"]
        if normalized.get("credential_ref") is None and normalized.get("credential_id"):
            normalized["credential_ref"] = {
                "type": "tool",
                "id": normalized.get("credential_id"),
                "provider": normalized.get("provider_id") or normalized.get("provider"),
            }
        return normalized

    @model_validator(mode="after")
    def _validate_provider_and_credentials(self) -> "AgentSoulDifyToolConfig":
        if not self.provider_id and not (self.plugin_id and self.provider):
            raise ValueError("Dify tool requires provider_id or plugin_id + provider")
        if self.credential_type != "unauthorized" and (self.credential_ref is None or not self.credential_ref.id):
            raise ValueError("credential_ref.id is required for credentialed Dify tools")
        # ``name`` is reserved for a future user-rename UX. Until that lands
        # the model-visible name is forced to match ``tool_name``; reject
        # explicit values so a frontend bug surfaces immediately instead of
        # producing a silently-ignored override.
        if self.name is not None and self.name != self.tool_name:
            raise ValueError("name override is not yet supported; omit ``name`` or set it equal to ``tool_name``.")
        return self


class AgentSoulToolsConfig(BaseModel):
    dify_tools: list[AgentSoulDifyToolConfig] = Field(default_factory=list)
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
    """File-type output metadata. Both lists empty means "any file accepted"."""

    model_config = ConfigDict(extra="forbid")

    extensions: list[str] = Field(default_factory=list)
    mime_types: list[str] = Field(default_factory=list)


class DeclaredArrayItem(BaseModel):
    """Per-item shape for an ``array``-typed declared output.

    PRD §OUTPUT 配置框 keeps arrays one level deep on first version; nested arrays
    are rejected so the runtime type checker and JSON Schema stay easy to reason
    about. Stage 4 §4.2.
    """

    model_config = ConfigDict(extra="forbid")

    type: DeclaredOutputType
    description: str | None = None

    @model_validator(mode="after")
    def _reject_nested_array(self) -> "DeclaredArrayItem":
        if self.type == DeclaredOutputType.ARRAY:
            raise ValueError("nested arrays are not supported as array_item.type")
        return self


class DeclaredOutputCheckConfig(BaseModel):
    """File-output content check via a model-based comparison against a benchmark file.

    Per PRD §OUTPUT 配置框, output check is **file-only** and optional. Stage 4 §4.3.
    """

    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    prompt: str | None = None
    benchmark_file_ref: dict[str, Any] | None = None
    # Reserved for stage 4.1: pick a different model than Agent Soul's for the check.
    # Stage 4 leaves this Optional and unused by FileOutputCheckExecutor.
    model_ref: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _require_prompt_and_benchmark_when_enabled(self) -> "DeclaredOutputCheckConfig":
        if self.enabled:
            if not self.prompt or not self.prompt.strip():
                raise ValueError("prompt is required when output check is enabled")
            if self.benchmark_file_ref is None:
                raise ValueError("benchmark_file_ref is required when output check is enabled")
        return self


class DeclaredOutputRetryConfig(BaseModel):
    """Per-output retry configuration that mirrors ``graphon.RetryConfig`` shape."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    max_retries: int = Field(default=0, ge=0, le=10)
    retry_interval_ms: int = Field(default=0, ge=0, le=60_000)


class DeclaredOutputFailureStrategy(BaseModel):
    """Per-output failure handling.

    A single strategy applies to both ``type_check`` and ``output_check`` failures
    (PRD does not distinguish them at the UX level). Stage 4 §4.4.
    """

    model_config = ConfigDict(extra="forbid")

    retry: DeclaredOutputRetryConfig = Field(default_factory=DeclaredOutputRetryConfig)
    on_failure: OutputErrorStrategy = OutputErrorStrategy.STOP
    # When ``on_failure == DEFAULT_VALUE`` this value replaces the failed output. The
    # value's shape must match the owning ``DeclaredOutputConfig.type``; that match is
    # enforced at ``DeclaredOutputConfig`` level so the strategy stays type-agnostic.
    default_value: Any = None

    @model_validator(mode="after")
    def _require_default_value_when_default_strategy(self) -> "DeclaredOutputFailureStrategy":
        if self.on_failure == OutputErrorStrategy.DEFAULT_VALUE and self.default_value is None:
            raise ValueError(
                "default_value must be provided when on_failure=default_value; None is reserved for 'not set'."
            )
        return self


class DeclaredOutputConfig(BaseModel):
    """One declared output of a Workflow Agent Node.

    Stage 4 normalizes the shape: ``check`` is singular (was ``checks: list`` in
    stage 3), and ``failure_strategy`` defaults to a populated value so runtime
    code can call ``output.failure_strategy.on_failure`` without None-guards.
    """

    model_config = ConfigDict(extra="forbid")

    id: str | None = None
    name: str = Field(min_length=1, max_length=255)
    type: DeclaredOutputType
    description: str | None = None
    required: bool = True
    file: DeclaredOutputFileConfig | None = None
    array_item: DeclaredArrayItem | None = None
    check: DeclaredOutputCheckConfig | None = None
    failure_strategy: DeclaredOutputFailureStrategy = Field(default_factory=DeclaredOutputFailureStrategy)

    @field_validator("failure_strategy", mode="before")
    @classmethod
    def _coerce_none_failure_strategy(cls, value: Any) -> Any:
        # Backward compat: persisted JSON may carry ``failure_strategy: null``;
        # treat it as "use defaults".
        if value is None:
            return DeclaredOutputFailureStrategy()
        return value

    @model_validator(mode="after")
    def _validate_shape(self) -> "DeclaredOutputConfig":
        if not _OUTPUT_NAME_PATTERN.fullmatch(self.name):
            raise ValueError(
                f"output name {self.name!r} must match {_OUTPUT_NAME_PATTERN.pattern} (JSON-schema-friendly identifier)"
            )

        if self.type == DeclaredOutputType.FILE:
            if self.file is None:
                self.file = DeclaredOutputFileConfig()
        elif self.file is not None:
            raise ValueError("file metadata is only allowed for file outputs")

        if self.type == DeclaredOutputType.ARRAY:
            if self.array_item is None:
                # Backward compat for stage 3 fixtures: array without array_item
                # defaults to array<object>, matching the prior JSON-Schema behavior.
                self.array_item = DeclaredArrayItem(type=DeclaredOutputType.OBJECT)
        elif self.array_item is not None:
            raise ValueError("array_item is only allowed when type is array")

        # Per PRD §OUTPUT 配置框: output check is file-only.
        if self.check is not None and self.check.enabled and self.type != DeclaredOutputType.FILE:
            raise ValueError("output check is only allowed for file outputs")

        # If the strategy is DEFAULT_VALUE, validate the default's shape against the
        # declared type so we fail at save-time rather than at runtime.
        strategy = self.failure_strategy
        if strategy.on_failure == OutputErrorStrategy.DEFAULT_VALUE and strategy.default_value is not None:
            self._assert_default_value_matches_type(strategy.default_value)

        return self

    def _assert_default_value_matches_type(self, value: Any) -> None:
        type_ = self.type
        if type_ == DeclaredOutputType.STRING:
            ok = isinstance(value, str)
        elif type_ == DeclaredOutputType.NUMBER:
            ok = isinstance(value, (int, float)) and not isinstance(value, bool)
        elif type_ == DeclaredOutputType.BOOLEAN:
            ok = isinstance(value, bool)
        elif type_ == DeclaredOutputType.OBJECT:
            ok = isinstance(value, dict)
        elif type_ == DeclaredOutputType.ARRAY:
            ok = isinstance(value, list)
        elif type_ == DeclaredOutputType.FILE:
            ok = isinstance(value, dict) and "file_id" in value
        else:
            ok = False
        if not ok:
            raise ValueError(
                f"default_value shape does not match output type {type_.value!r}: got {type(value).__name__}"
            )


# PRD §OUTPUT 配置框 0522 共识: "Output 如果没有配置，则 text, files, json"
# The runtime injects these when ``declared_outputs`` is empty (stage 4 §4.1, D-3).
# Not persisted; mutating this constant changes UI defaults globally.
DEFAULT_DECLARED_OUTPUTS: Final[tuple[DeclaredOutputConfig, ...]] = (
    DeclaredOutputConfig(
        name="text",
        type=DeclaredOutputType.STRING,
        required=False,
        description="Free-form text answer.",
    ),
    DeclaredOutputConfig(
        name="files",
        type=DeclaredOutputType.ARRAY,
        required=False,
        description="Files produced by the agent.",
        array_item=DeclaredArrayItem(type=DeclaredOutputType.FILE),
    ),
    DeclaredOutputConfig(
        name="json",
        type=DeclaredOutputType.OBJECT,
        required=False,
        description="Free-form JSON object.",
    ),
)


def effective_declared_outputs(
    declared_outputs: list[DeclaredOutputConfig] | tuple[DeclaredOutputConfig, ...],
) -> tuple[DeclaredOutputConfig, ...]:
    """Return the outputs the runtime actually presents.

    Returns ``declared_outputs`` unchanged when non-empty, otherwise the PRD
    defaults from ``DEFAULT_DECLARED_OUTPUTS``. Shared helper so Composer load
    responses, runtime request builder, and the Node Output Inspector all use
    the same fallback (stage 4 §4.1, decision D-3).
    """
    if declared_outputs:
        return tuple(declared_outputs)
    return DEFAULT_DECLARED_OUTPUTS


class WorkflowNodeJobConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = 1
    mode: WorkflowNodeJobMode = WorkflowNodeJobMode.TELL_AGENT_WHAT_TO_DO
    workflow_prompt: str = ""
    previous_node_output_refs: list[dict[str, Any]] = Field(default_factory=list)
    declared_outputs: list[DeclaredOutputConfig] = Field(default_factory=list)
    human_contacts: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
