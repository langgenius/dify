from __future__ import annotations

import re
from enum import StrEnum
from typing import Annotated, Any, Final, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, WithJsonSchema, field_validator, model_validator

from core.rag.entities.metadata_entities import ConditionValue, SupportedComparisonOperator
from core.workflow.file_reference import is_canonical_file_reference
from graphon.file import FileTransferMethod, FileType


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


_DECLARED_OUTPUT_CHILDREN_JSON_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "name": {"type": "string"},
            "type": {
                "type": "string",
                "enum": [item.value for item in DeclaredOutputType],
            },
            "description": {"anyOf": [{"type": "string"}, {"type": "null"}]},
            "required": {"type": "boolean"},
            "file": {"type": "object", "additionalProperties": True},
            "array_item": {
                "type": "object",
                "additionalProperties": True,
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": [item.value for item in DeclaredOutputType],
                    },
                    "description": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                    "children": {"type": "array", "items": {"type": "object", "additionalProperties": True}},
                },
            },
            "children": {"type": "array", "items": {"type": "object", "additionalProperties": True}},
        },
        "required": ["name", "type"],
    },
}

DeclaredOutputChildren = Annotated[
    list["DeclaredOutputChildConfig"],
    WithJsonSchema(_DECLARED_OUTPUT_CHILDREN_JSON_SCHEMA),
]


class AgentCliToolAuthorizationStatus(StrEnum):
    """Authorization state for Agent-scoped CLI tools.

    Missing status keeps backward compatibility with draft rows and CLI tools that
    do not need pre-authorization. Explicit denied-like states are blocked by the
    composer/publish validators and skipped by runtime request builders.
    """

    AUTHORIZED = "authorized"
    PRE_AUTHORIZED = "pre_authorized"
    ALLOWED = "allowed"
    NOT_REQUIRED = "not_required"
    UNAUTHORIZED = "unauthorized"
    PENDING = "pending"
    DENIED = "denied"
    FORBIDDEN = "forbidden"


class AgentCliToolRiskLevel(StrEnum):
    """Risk marker for CLI tool bootstrap commands."""

    SAFE = "safe"
    DANGEROUS = "dangerous"
    UNKNOWN = "unknown"


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
_CONFIG_SKILL_NAME_PATTERN: Final[re.Pattern[str]] = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

JsonPrimitive = str | int | float | bool | None
RuntimeParameterValue = JsonPrimitive | list[str] | list[int] | list[float] | list[bool]


class AgentFlexibleConfig(BaseModel):
    model_config = ConfigDict(extra="allow")

    def get(self, key: str, default: Any = None) -> Any:
        return self.model_dump(mode="python").get(key, default)

    def items(self):
        return self.model_dump(mode="python").items()

    def __bool__(self) -> bool:
        return bool(self.model_dump(mode="python", exclude_none=True, exclude_defaults=True))


class AgentFileRefConfig(AgentFlexibleConfig):
    id: str | None = Field(default=None, max_length=255)
    file_id: str | None = Field(default=None, max_length=255)
    upload_file_id: str | None = Field(default=None, max_length=255)
    reference: str | None = Field(default=None, max_length=255)
    tenant_id: str | None = Field(default=None, max_length=255)
    name: str | None = Field(default=None, max_length=255)
    type: str | None = Field(default=None, max_length=64)
    transfer_method: str | None = Field(default=None, max_length=64)
    url: str | None = None
    remote_url: str | None = None
    # Drive key once the file is committed to the agent drive ("files/<name>",
    # ENG-625). Files without it are plain upload references and stay invisible
    # to the runtime drive manifest.
    drive_key: str | None = Field(default=None, max_length=512)


class AgentSkillRefConfig(AgentFlexibleConfig):
    id: str | None = Field(default=None, max_length=255)
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    file_id: str | None = Field(default=None, max_length=255)
    path: str | None = None
    # Standardization outputs (ENG-594) — previously riding along via
    # ``extra="allow"``, promoted to the explicit schema because the runtime
    # drive manifest (ENG-623) keys off them.
    skill_md_key: str | None = Field(default=None, max_length=512)
    skill_md_file_id: str | None = Field(default=None, max_length=255)
    full_archive_key: str | None = Field(default=None, max_length=512)
    full_archive_file_id: str | None = Field(default=None, max_length=255)
    # Zip member path listing from standardization (ENG-371): lets infer-tools
    # show the model strong signals like ``scripts/*.sh`` without unpacking.
    manifest_files: list[str] | None = None


class AgentSoulFilesConfig(BaseModel):
    skills: list[AgentSkillRefConfig] = Field(default_factory=list)
    files: list[AgentFileRefConfig] = Field(default_factory=list)


def validate_config_name(name: str) -> str:
    normalized = name.strip()
    if not normalized:
        raise ValueError("config asset name must not be blank")
    if normalized in {".", ".."}:
        raise ValueError("config asset name must not be '.' or '..'")
    if "/" in normalized or "\\" in normalized:
        raise ValueError("config asset name must be a single path segment")
    if "\x00" in normalized or any(ord(ch) < 0x20 for ch in normalized):
        raise ValueError("config asset name must not contain control characters")
    return normalized


def validate_config_skill_name(name: str) -> str:
    normalized = validate_config_name(name)
    if _CONFIG_SKILL_NAME_PATTERN.fullmatch(normalized) is None:
        raise ValueError(f"config skill name {normalized!r} must match {_CONFIG_SKILL_NAME_PATTERN.pattern}")
    return normalized


class AgentConfigFileRefConfig(BaseModel):
    """Stable Agent Soul reference to one config file payload."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    file_kind: Literal["upload_file", "tool_file"]
    file_id: str = Field(min_length=1, max_length=255)
    size: int | None = None
    hash: str | None = None
    mime_type: str | None = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        return validate_config_name(value)


class AgentConfigSkillRefConfig(BaseModel):
    """Stable Agent Soul reference to one normalized skill archive."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    description: str = ""
    file_kind: Literal["tool_file"] = "tool_file"
    file_id: str = Field(min_length=1, max_length=255)
    size: int | None = None
    hash: str | None = None
    mime_type: str | None = "application/zip"

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        return validate_config_skill_name(value)


class AgentPermissionConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    allowed: bool | None = None
    status: str | None = Field(default=None, max_length=64)
    state: str | None = Field(default=None, max_length=64)


class AgentEnvVariableConfig(AgentFlexibleConfig):
    name: str | None = Field(default=None, max_length=255)
    key: str | None = Field(default=None, max_length=255)
    env_name: str | None = Field(default=None, max_length=255)
    variable: str | None = Field(default=None, max_length=255)
    type: str | None = Field(default=None, max_length=64)
    value: RuntimeParameterValue = None
    default: RuntimeParameterValue = None
    required: bool = False


class AgentSecretRefConfig(AgentFlexibleConfig):
    name: str | None = Field(default=None, max_length=255)
    key: str | None = Field(default=None, max_length=255)
    env_name: str | None = Field(default=None, max_length=255)
    variable: str | None = Field(default=None, max_length=255)
    type: str | None = Field(default=None, max_length=64)
    # User-provided secret value. Long API tokens are valid here; runtime maps
    # this field into a shell env var, while ref/id/credential_id fields keep the
    # backend-managed secret reference path.
    value: str | None = None
    id: str | None = Field(default=None, max_length=255)
    ref: str | None = Field(default=None, max_length=255)
    credential_id: str | None = Field(default=None, max_length=255)
    provider_credential_id: str | None = Field(default=None, max_length=255)
    provider: str | None = Field(default=None, max_length=255)
    permission: AgentPermissionConfig | None = None
    permission_status: str | None = Field(default=None, max_length=64)


class AgentCliToolEnvConfig(BaseModel):
    variables: list[AgentEnvVariableConfig] = Field(default_factory=list)
    secret_refs: list[AgentSecretRefConfig] = Field(default_factory=list)


class AgentCliToolConfig(AgentFlexibleConfig):
    # Stable mention/reference id (minted by the frontend on creation, backfilled at
    # composer save) so renaming a CLI tool never breaks `[§cli_tool:<id>§]` mentions.
    id: str | None = Field(default=None, max_length=255)
    enabled: bool = True
    name: str | None = Field(default=None, max_length=255)
    tool_name: str | None = Field(default=None, max_length=255)
    label: str | None = Field(default=None, max_length=255)
    description: str | None = None
    command: str | None = None
    install_commands: list[str] = Field(default_factory=list)
    install_command: str | None = None
    install: str | None = None
    setup_command: str | None = None
    invoke_metadata: dict[str, Any] = Field(default_factory=dict)
    env: AgentCliToolEnvConfig = Field(default_factory=AgentCliToolEnvConfig)
    pre_authorized: bool | None = None
    authorization_status: AgentCliToolAuthorizationStatus | None = None
    permission: AgentPermissionConfig | None = None
    dangerous: bool = False
    dangerous_command: bool = False
    requires_confirmation: bool = False
    dangerous_acknowledged: bool = False
    dangerous_accepted: bool = False
    risk_accepted: bool = False
    approved: bool = False
    risk_level: AgentCliToolRiskLevel | None = None
    # Slug of the skill an infer-tools suggestion came from (ENG-371); drives
    # the "inferred from <skill>" badge. Plain provenance metadata — saving an
    # inferred tool still passes every composer validation rule.
    inferred_from: str | None = Field(default=None, max_length=255)


class AgentKnowledgeDatasetConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str | None = Field(default=None, max_length=255)
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None


class AgentKnowledgeQueryConfig(BaseModel):
    """Per-set query policy for Agent v2 knowledge retrieval.

    Agent v2 stores knowledge as explicit ``knowledge.sets`` rather than the
    legacy flat ``datasets`` / ``query_mode`` / ``query_config`` shape. Each
    set owns its own query policy, so ``user_query`` must carry an explicit
    ``value`` while ``generated_query`` leaves that value empty.
    """

    model_config = ConfigDict(extra="forbid")

    mode: AgentKnowledgeQueryMode
    value: str | None = None

    @model_validator(mode="after")
    def validate_query(self) -> Self:
        if self.mode == AgentKnowledgeQueryMode.USER_QUERY and not (self.value or "").strip():
            raise ValueError("knowledge query.value is required for user_query mode")
        return self


class AgentKnowledgeModelConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str = Field(min_length=1, max_length=255)
    name: str = Field(min_length=1, max_length=255)
    mode: str = Field(min_length=1, max_length=64)
    completion_params: dict[str, Any] = Field(default_factory=dict)


class AgentKnowledgeRerankingModelConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str = Field(min_length=1, max_length=255)
    model: str = Field(min_length=1, max_length=255)


class AgentKnowledgeWeightedScoreConfig(AgentFlexibleConfig):
    weight_type: str | None = Field(default=None, max_length=64)
    vector_setting: dict[str, Any] | None = None
    keyword_setting: dict[str, Any] | None = None


class AgentKnowledgeRetrievalConfig(BaseModel):
    """Per-set retrieval policy for Agent v2 knowledge retrieval.

    Retrieval settings now live on each knowledge set instead of one shared
    flat config. A set may use either ``multiple`` retrieval with ``top_k`` or
    ``single`` retrieval with a required model config.
    """

    model_config = ConfigDict(extra="forbid")

    mode: Literal["single", "multiple"]
    top_k: int | None = Field(default=None, ge=1)
    score_threshold: float | None = Field(default=None, ge=0, le=1)
    reranking_mode: str = "reranking_model"
    reranking_enable: bool = True
    reranking_model: AgentKnowledgeRerankingModelConfig | None = None
    weights: AgentKnowledgeWeightedScoreConfig | None = None
    model: AgentKnowledgeModelConfig | None = None

    @model_validator(mode="after")
    def validate_mode_fields(self) -> Self:
        if self.mode == "multiple" and self.top_k is None:
            raise ValueError("knowledge retrieval.top_k is required for multiple mode")
        if self.mode == "single" and self.model is None:
            raise ValueError("knowledge retrieval.model is required for single mode")
        return self


class AgentKnowledgeMetadataCondition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    comparison_operator: SupportedComparisonOperator
    value: ConditionValue = None


class AgentKnowledgeMetadataConditions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    logical_operator: Literal["and", "or"] = "and"
    conditions: list[AgentKnowledgeMetadataCondition] = Field(default_factory=list)


class AgentKnowledgeMetadataFilteringConfig(BaseModel):
    """Per-set metadata filtering policy.

    The Python attribute uses ``metadata_model_config`` for clarity because the
    model belongs to metadata filtering specifically, while the external API and
    generated schema keep the historical ``model_config`` field name via alias.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    mode: Literal["disabled", "automatic", "manual"] = "disabled"
    # Internal name is explicit; wire format remains ``model_config``.
    metadata_model_config: AgentKnowledgeModelConfig | None = Field(default=None, alias="model_config")
    conditions: AgentKnowledgeMetadataConditions | None = None

    @model_validator(mode="after")
    def validate_mode_fields(self) -> Self:
        if self.mode == "automatic" and self.metadata_model_config is None:
            raise ValueError("metadata_filtering.model_config is required for automatic mode")
        if self.mode == "manual" and (self.conditions is None or not self.conditions.conditions):
            raise ValueError("metadata_filtering.conditions is required for manual mode")
        return self


class AgentKnowledgeSetConfig(BaseModel):
    """One explicit knowledge set in Agent v2.

    ``knowledge.sets`` replaces the old flat knowledge config. Each set owns
    its datasets plus query, retrieval, and metadata policies. An individual
    set must contain at least one dataset id even though the overall knowledge
    section may be empty, which is how callers express "no knowledge layer".
    """

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=255)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    datasets: list[AgentKnowledgeDatasetConfig]
    query: AgentKnowledgeQueryConfig
    retrieval: AgentKnowledgeRetrievalConfig
    metadata_filtering: AgentKnowledgeMetadataFilteringConfig = Field(
        default_factory=AgentKnowledgeMetadataFilteringConfig
    )

    @field_validator("id", "name")
    @classmethod
    def validate_non_blank_identity(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("knowledge set id and name must not be blank")
        return normalized

    @model_validator(mode="after")
    def validate_datasets(self) -> Self:
        dataset_ids = [(dataset.id or "").strip() for dataset in self.datasets]
        if not dataset_ids or any(not dataset_id for dataset_id in dataset_ids):
            raise ValueError("knowledge set requires at least one dataset id")
        if len(dataset_ids) != len(set(dataset_ids)):
            raise ValueError("knowledge set dataset ids must be unique")
        return self


class AgentHumanContactConfig(AgentFlexibleConfig):
    id: str | None = Field(default=None, max_length=255)
    contact_id: str | None = Field(default=None, max_length=255)
    human_id: str | None = Field(default=None, max_length=255)
    tenant_id: str | None = Field(default=None, max_length=255)
    name: str | None = Field(default=None, max_length=255)
    email: str | None = Field(default=None, max_length=255)
    channel: str | None = Field(default=None, max_length=64)
    method: str | None = Field(default=None, max_length=64)
    contact_method: str | None = Field(default=None, max_length=64)


class AgentHumanToolConfig(AgentFlexibleConfig):
    enabled: bool = True
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None


class AgentSandboxProviderConfig(AgentFlexibleConfig):
    image: str | None = None
    working_dir: str | None = None
    env: list[AgentEnvVariableConfig] = Field(default_factory=list)
    cpu: int | None = Field(default=None, ge=1)


class AgentMemoryArtifactConfig(AgentFlexibleConfig):
    id: str | None = Field(default=None, max_length=255)
    type: str | None = Field(default=None, max_length=64)
    name: str | None = Field(default=None, max_length=255)
    url: str | None = None


class AgentModelResponseFormatConfig(AgentFlexibleConfig):
    type: str | None = Field(default=None, max_length=64)


class AgentSoulModelSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")

    temperature: float | None = None
    top_p: float | None = None
    presence_penalty: float | None = None
    frequency_penalty: float | None = None
    max_tokens: int | None = None
    stop: list[str] | None = None
    response_format: AgentModelResponseFormatConfig | None = None


class AgentFeatureToggleConfig(AgentFlexibleConfig):
    enabled: bool = False


class AgentTextToSpeechFeatureConfig(AgentFeatureToggleConfig):
    language: str | None = None
    voice: str | None = None
    autoPlay: str | None = None


class AgentSuggestedQuestionsAfterAnswerModelConfig(AgentFlexibleConfig):
    """Legacy Chat App model config used only for follow-up question generation."""

    provider: str = Field(min_length=1, max_length=255)
    name: str = Field(min_length=1, max_length=255)
    mode: str | None = Field(default=None, max_length=64)
    completion_params: dict[str, Any] | None = None


class AgentSuggestedQuestionsAfterAnswerFeatureConfig(AgentFeatureToggleConfig):
    prompt: str | None = None
    model: AgentSuggestedQuestionsAfterAnswerModelConfig | None = None


class AgentModerationIOConfig(AgentFlexibleConfig):
    enabled: bool = False
    preset_response: str | None = None


class AgentModerationProviderConfig(AgentFlexibleConfig):
    keywords: str | None = None
    api_based_extension_id: str | None = None
    inputs_config: AgentModerationIOConfig | None = None
    outputs_config: AgentModerationIOConfig | None = None


class AgentSensitiveWordAvoidanceFeatureConfig(AgentFeatureToggleConfig):
    type: str | None = None
    config: AgentModerationProviderConfig | None = None


class AgentFileUploadImageFeatureConfig(AgentFeatureToggleConfig):
    enabled: bool = True


class AgentFileUploadFeatureConfig(AgentFeatureToggleConfig):
    enabled: bool = True
    allowed_file_extensions: list[str] = Field(default_factory=lambda: ["JPG", "JPEG", "PNG", "GIF", "WEBP", "SVG"])
    allowed_file_types: list[FileType] = Field(
        default_factory=lambda: [FileType.DOCUMENT, FileType.IMAGE, FileType.AUDIO, FileType.VIDEO]
    )
    allowed_file_upload_methods: list[FileTransferMethod] = Field(
        default_factory=lambda: [FileTransferMethod.LOCAL_FILE, FileTransferMethod.REMOTE_URL]
    )
    image: AgentFileUploadImageFeatureConfig = Field(default_factory=AgentFileUploadImageFeatureConfig)
    number_limits: int = 3


class AgentSoulAppFeaturesConfig(AgentFlexibleConfig):
    opening_statement: str | None = None
    suggested_questions: list[str] | None = None
    suggested_questions_after_answer: AgentSuggestedQuestionsAfterAnswerFeatureConfig | None = None
    speech_to_text: AgentFeatureToggleConfig | None = None
    text_to_speech: AgentTextToSpeechFeatureConfig | None = None
    retriever_resource: AgentFeatureToggleConfig | None = None
    sensitive_word_avoidance: AgentSensitiveWordAvoidanceFeatureConfig | None = None
    file_upload: AgentFileUploadFeatureConfig = Field(default_factory=AgentFileUploadFeatureConfig)


class WorkflowPreviousNodeOutputRef(AgentFlexibleConfig):
    selector: list[JsonPrimitive] | None = None
    variable_selector: list[JsonPrimitive] | None = None
    value_selector: list[JsonPrimitive] | None = None
    node_id: str | None = Field(default=None, max_length=255)
    output: str | None = Field(default=None, max_length=255)
    name: str | None = Field(default=None, max_length=255)
    variable: str | None = Field(default=None, max_length=255)
    key: str | None = Field(default=None, max_length=255)


class WorkflowNodeJobMetadata(BaseModel):
    model_config = ConfigDict(extra="ignore")

    file_refs: list[AgentFileRefConfig] | None = None
    agent_soul: dict[str, Any] | None = Field(default=None)


class AgentSoulPromptConfig(BaseModel):
    system_prompt: str = ""


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
    """One Dify tool configured on Agent Soul.

    The API backend prepares this persisted product shape into
    either ``DifyPluginToolConfig`` or ``DifyCoreToolConfig`` before sending a
    run request to Agent backend. ``plugin`` providers keep the direct
    ``dify.plugin.tools`` transport; ``builtin`` / ``api`` / ``workflow`` /
    ``mcp`` providers are prepared for ``dify.core.tools``. ``provider_id``
    keeps compatibility with existing Agent tool config payloads; new callers
    should send ``plugin_id`` + ``provider`` when available.
    """

    # ``extra="ignore"`` (not ``"allow"``) so historical Agent Soul payloads
    # with unknown fields still load — but the extra keys are dropped instead
    # of silently riding along into ``model_dump``. New callers should send the
    # explicit schema fields below.
    model_config = ConfigDict(extra="ignore")

    enabled: bool = True
    # ``plugin`` remains the default for legacy Agent Soul payloads. The runtime
    # now also accepts ``builtin`` / ``api`` / ``workflow`` / ``mcp`` here and
    # routes them through ``dify.core.tools``; keeping the default narrow still
    # makes a missing field resolve against the plugin provider table.
    provider_type: str = "plugin"
    provider_id: str | None = Field(default=None, max_length=255)
    plugin_id: str | None = Field(default=None, max_length=255)
    provider: str | None = Field(default=None, max_length=255)
    # ``None`` = provider-level entry selecting ALL tools of the provider (a
    # provider hosts many tools, like an MCP server). The runtime expands the
    # entry into every tool the provider currently declares; ``credential_ref``
    # applies to all of them. Mention form: ``[§tool:<provider>/*§]``.
    tool_name: str | None = Field(default=None, min_length=1, max_length=255)
    credential_type: Literal["api-key", "oauth2", "unauthorized"] = "api-key"
    credential_ref: AgentSoulDifyToolCredentialRef | None = None
    # Reserved for a future user-rename UX. Accepted but currently rejected at
    # validation time so frontend cannot silently believe a rename took effect
    # (see :meth:`_validate_provider_and_credentials`).
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    runtime_parameters: dict[str, RuntimeParameterValue] = Field(default_factory=dict)

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
    def _validate_provider_and_credentials(self) -> AgentSoulDifyToolConfig:
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
    cli_tools: list[AgentCliToolConfig] = Field(default_factory=list)


class AgentSoulKnowledgeConfig(BaseModel):
    """Top-level Agent v2 knowledge config.

    Agent v2 models knowledge as explicit sets instead of one flat
    ``datasets`` / ``query_mode`` / ``query_config`` block. An empty ``sets``
    list means no knowledge layer should be emitted at runtime, while set-name
    uniqueness stays case-insensitive because runtime selection addresses sets
    by name.
    """

    model_config = ConfigDict(extra="forbid")

    sets: list[AgentKnowledgeSetConfig] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_unique_sets(self) -> Self:
        set_ids = [item.id.strip() for item in self.sets]
        if len(set_ids) != len(set(set_ids)):
            raise ValueError("knowledge set ids must be unique")
        set_names = [item.name.strip().lower() for item in self.sets]
        if len(set_names) != len(set(set_names)):
            raise ValueError("knowledge set names must be unique")
        return self


class AgentSoulHumanConfig(BaseModel):
    contacts: list[AgentHumanContactConfig] = Field(default_factory=list)
    tools: list[AgentHumanToolConfig] = Field(default_factory=list)


class AgentSoulEnvConfig(BaseModel):
    variables: list[AgentEnvVariableConfig] = Field(default_factory=list)
    secret_refs: list[AgentSecretRefConfig] = Field(default_factory=list)


class AgentSoulSandboxConfig(BaseModel):
    provider: str | None = None
    config: AgentSandboxProviderConfig = Field(default_factory=AgentSandboxProviderConfig)


class AgentSoulMemoryConfig(BaseModel):
    scope: str | None = None
    budget: str | None = None
    artifacts: list[AgentMemoryArtifactConfig] = Field(default_factory=list)


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
    model_settings: AgentSoulModelSettings = Field(default_factory=AgentSoulModelSettings)


class AppVariableConfig(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    type: str = Field(min_length=1, max_length=64)
    required: bool = False
    default: Any = Field(default=None)


class AgentSoulConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = 1
    prompt: AgentSoulPromptConfig = Field(default_factory=AgentSoulPromptConfig)
    tools: AgentSoulToolsConfig = Field(default_factory=AgentSoulToolsConfig)
    knowledge: AgentSoulKnowledgeConfig = Field(default_factory=AgentSoulKnowledgeConfig)
    human: AgentSoulHumanConfig = Field(default_factory=AgentSoulHumanConfig)
    env: AgentSoulEnvConfig = Field(default_factory=AgentSoulEnvConfig)
    config_skills: list[AgentConfigSkillRefConfig] = Field(default_factory=list)
    config_files: list[AgentConfigFileRefConfig] = Field(default_factory=list)
    config_note: str = ""
    files: AgentSoulFilesConfig = Field(default_factory=AgentSoulFilesConfig)
    sandbox: AgentSoulSandboxConfig = Field(default_factory=AgentSoulSandboxConfig)
    memory: AgentSoulMemoryConfig = Field(default_factory=AgentSoulMemoryConfig)
    model: AgentSoulModelConfig | None = None
    app_features: AgentSoulAppFeaturesConfig = Field(default_factory=AgentSoulAppFeaturesConfig)
    app_variables: list[AppVariableConfig] = Field(default_factory=list)
    misc_legacy: AgentSoulAppFeaturesConfig = Field(default_factory=AgentSoulAppFeaturesConfig)


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
    children: DeclaredOutputChildren = Field(default_factory=list)

    @model_validator(mode="after")
    def _reject_nested_array(self) -> DeclaredArrayItem:
        if self.type == DeclaredOutputType.ARRAY:
            raise ValueError("nested arrays are not supported as array_item.type")
        if self.children and self.type != DeclaredOutputType.OBJECT:
            raise ValueError("array_item.children is only allowed when array_item.type is object")
        return self


class DeclaredOutputChildConfig(BaseModel):
    """Nested field under an object-shaped declared output.

    The first backend version keeps child fields lightweight: they describe the
    variable-picker/schema tree but do not own independent retry/check behavior.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    type: DeclaredOutputType
    description: str | None = None
    required: bool = True
    file: DeclaredOutputFileConfig | None = None
    array_item: DeclaredArrayItem | None = None
    children: DeclaredOutputChildren = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate_shape(self) -> DeclaredOutputChildConfig:
        if not _OUTPUT_NAME_PATTERN.fullmatch(self.name):
            raise ValueError(
                f"output child name {self.name!r} must match {_OUTPUT_NAME_PATTERN.pattern} "
                "(JSON-schema-friendly identifier)"
            )
        if self.type == DeclaredOutputType.FILE:
            if self.file is None:
                self.file = DeclaredOutputFileConfig()
        elif self.file is not None:
            raise ValueError("file metadata is only allowed for file output children")

        if self.type == DeclaredOutputType.ARRAY:
            if self.array_item is None:
                self.array_item = DeclaredArrayItem(type=DeclaredOutputType.OBJECT)
        elif self.array_item is not None:
            raise ValueError("array_item is only allowed when child type is array")

        if self.children and self.type != DeclaredOutputType.OBJECT:
            raise ValueError("children is only allowed for object output children")
        return self


class DeclaredOutputCheckConfig(BaseModel):
    """File-output content check via a model-based comparison against a benchmark file.

    Per PRD §OUTPUT 配置框, output check is **file-only** and optional. Stage 4 §4.3.
    """

    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    prompt: str | None = None
    benchmark_file_ref: AgentFileRefConfig | None = None
    # Reserved for stage 4.1: pick a different model than Agent Soul's for the check.
    # Stage 4 leaves this Optional and unused by FileOutputCheckExecutor.
    model_ref: AgentSoulModelConfig | None = None

    @model_validator(mode="after")
    def _require_prompt_and_benchmark_when_enabled(self) -> DeclaredOutputCheckConfig:
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
    default_value: Any = Field(default=None)

    @model_validator(mode="after")
    def _require_default_value_when_default_strategy(self) -> DeclaredOutputFailureStrategy:
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
    children: DeclaredOutputChildren = Field(default_factory=list)
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
    def _validate_shape(self) -> DeclaredOutputConfig:
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

        if self.children and self.type != DeclaredOutputType.OBJECT:
            raise ValueError("children is only allowed for object outputs")

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
            if ok and self.array_item is not None and self.array_item.type == DeclaredOutputType.FILE:
                ok = all(self._is_valid_file_default_value(item) for item in value)
        elif type_ == DeclaredOutputType.FILE:
            ok = self._is_valid_file_default_value(value)
        else:
            ok = False
        if not ok:
            raise ValueError(
                f"default_value shape does not match output type {type_.value!r}: got {type(value).__name__}"
            )

    @staticmethod
    def _is_valid_file_default_value(value: Any) -> bool:
        if not isinstance(value, dict):
            return False
        transfer_method_raw = value.get("transfer_method")
        if not isinstance(transfer_method_raw, str):
            return False
        try:
            transfer_method = FileTransferMethod.value_of(transfer_method_raw)
        except ValueError:
            return False

        if transfer_method == FileTransferMethod.REMOTE_URL:
            return (
                set(value) == {"transfer_method", "url"}
                and isinstance(value.get("url"), str)
                and bool(value.get("url"))
            )

        reference = value.get("reference")
        return (
            set(value) == {"transfer_method", "reference"}
            and isinstance(reference, str)
            and is_canonical_file_reference(reference)
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
    previous_node_output_refs: list[WorkflowPreviousNodeOutputRef] = Field(default_factory=list)
    declared_outputs: list[DeclaredOutputConfig] = Field(default_factory=list)
    human_contacts: list[AgentHumanContactConfig] = Field(default_factory=list)
    metadata: WorkflowNodeJobMetadata = Field(default_factory=WorkflowNodeJobMetadata)
