"""Client-safe DTOs for Dify plugin-backed Agenton business layers.

This module intentionally contains only public config schemas and scalar type
aliases plus stable plugin business-layer type identifiers. Runtime objects
such as HTTP clients, server settings, and adapter implementations live in
sibling implementation modules so clients can build run requests without
importing server-only dependencies.

Shared tenant/user/run context now lives in the sibling
``dify_agent.layers.execution_context`` package. This module only covers the
plugin-backed LLM and tools layers that invoke daemon features with concrete
``plugin_id`` values. Tool configs also carry the API-side prepared parameter
declarations and model-visible JSON schema so the agent runtime does not have to
re-fetch and re-merge tool declarations at execution time.
"""

from enum import StrEnum
from typing import ClassVar, Final, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator
from pydantic_ai.settings import ModelSettings

from agenton.layers import LayerConfig


DifyPluginCredentialValue: TypeAlias = str | int | float | bool | None
DifyPluginToolCredentialType: TypeAlias = Literal["api-key", "oauth2", "unauthorized"]
DifyPluginToolValue: TypeAlias = JsonValue
DIFY_PLUGIN_LLM_LAYER_TYPE_ID: Final[str] = "dify.plugin.llm"
DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID: Final[str] = "dify.plugin.tools"


class DifyPluginToolOption(BaseModel):
    """Selectable tool option value exposed to the model.

    The DTO also accepts API-side option dumps and attribute objects. Fields
    such as ``label`` or ``icon`` are intentionally ignored because Dify Agent
    only preserves the normalized option ``value`` for tool invocation and
    model-visible schema generation.
    """

    value: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", from_attributes=True)

    @field_validator("value", mode="before")
    @classmethod
    def stringify_value(cls, value: object) -> str:
        return value if isinstance(value, str) else str(value)


class DifyPluginToolParameterType(StrEnum):
    STRING = "string"
    NUMBER = "number"
    BOOLEAN = "boolean"
    SELECT = "select"
    SECRET_INPUT = "secret-input"
    FILE = "file"
    FILES = "files"
    APP_SELECTOR = "app-selector"
    MODEL_SELECTOR = "model-selector"
    ANY = "any"
    DYNAMIC_SELECT = "dynamic-select"
    CHECKBOX = "checkbox"
    SYSTEM_FILES = "system-files"
    ARRAY = "array"
    OBJECT = "object"

    def as_normal_type(self) -> str:
        if self in {
            DifyPluginToolParameterType.SECRET_INPUT,
            DifyPluginToolParameterType.SELECT,
            DifyPluginToolParameterType.CHECKBOX,
        }:
            return "string"
        return self.value


class DifyPluginToolParameterForm(StrEnum):
    SCHEMA = "schema"
    FORM = "form"
    LLM = "llm"


class DifyPluginToolParameter(BaseModel):
    """Prepared tool parameter declaration supplied by the API side.

    The DTO intentionally accepts both API-side ``ToolParameter`` dumps and
    attribute objects so callers can adapt existing tool runtime declarations
    without coupling Dify Agent to API-internal model classes.
    """

    name: str
    type: DifyPluginToolParameterType
    form: DifyPluginToolParameterForm
    required: bool = False
    default: DifyPluginToolValue = None
    llm_description: str | None = None
    input_schema: dict[str, JsonValue] | None = None
    options: list[DifyPluginToolOption] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", from_attributes=True)


class DifyPluginLLMLayerConfig(LayerConfig):
    """Public config for selecting a plugin-backed business provider/model."""

    plugin_id: str
    model_provider: str
    model: str
    credentials: dict[str, DifyPluginCredentialValue] = Field(default_factory=dict)
    model_settings: ModelSettings | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", arbitrary_types_allowed=True)


class DifyPluginToolConfig(LayerConfig):
    """Public config for exposing one plugin tool to the agent model.

    ``credential_type`` is an explicit caller-supplied daemon transport choice,
    not an auto-discovered property. It must match the actual credential mode of
    ``credentials`` for the configured plugin tool, for example ``"api-key"``
    versus ``"oauth2"``. A wrong value can make invocation fail at runtime even
    when the config itself validates successfully.

    ``runtime_parameters`` mirrors Dify's agent-node hidden/manual tool inputs:
    those values are merged into the actual daemon invocation but omitted from
    the tool schema shown to the model.

    ``parameters`` and ``parameters_json_schema`` are API-side prepared tool
    declaration artifacts. They let the agent runtime validate hidden/default
    inputs and expose the correct LLM-facing schema without re-fetching or
    re-merging daemon declarations at run time.
    """

    plugin_id: str
    provider: str
    tool_name: str
    credential_type: DifyPluginToolCredentialType
    name: str | None = None
    description: str | None = None
    credentials: dict[str, DifyPluginCredentialValue] = Field(default_factory=dict)
    runtime_parameters: dict[str, DifyPluginToolValue] = Field(default_factory=dict)
    parameters: list[DifyPluginToolParameter] = Field(default_factory=list)
    parameters_json_schema: dict[str, JsonValue] = Field(
        default_factory=lambda: {"type": "object", "properties": {}, "required": []}
    )

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", arbitrary_types_allowed=True)


class DifyPluginToolsLayerConfig(LayerConfig):
    """Public config for the Dify plugin tools layer.

    Callers configure the tools layer with this wrapper object and supply one
    or more prepared ``DifyPluginToolConfig`` entries in ``tools``.
    """

    tools: list[DifyPluginToolConfig] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", arbitrary_types_allowed=True)


__all__ = [
    "DIFY_PLUGIN_LLM_LAYER_TYPE_ID",
    "DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID",
    "DifyPluginCredentialValue",
    "DifyPluginLLMLayerConfig",
    "DifyPluginToolCredentialType",
    "DifyPluginToolConfig",
    "DifyPluginToolOption",
    "DifyPluginToolParameter",
    "DifyPluginToolParameterForm",
    "DifyPluginToolParameterType",
    "DifyPluginToolsLayerConfig",
    "DifyPluginToolValue",
]
