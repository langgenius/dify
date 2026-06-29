"""Client-safe DTOs for the Dify config declaration layer."""

from typing import ClassVar, Final, Literal

from pydantic import BaseModel, ConfigDict, Field

from agenton.layers import LayerConfig


DIFY_CONFIG_LAYER_TYPE_ID: Final[str] = "dify.config"


class DifyConfigVersionConfig(BaseModel):
    """Agent config version metadata visible to the runtime prompt."""

    id: str | None = None
    kind: Literal["snapshot", "draft", "build_draft"] = "snapshot"
    writable: bool = False

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class DifyConfigSkillConfig(BaseModel):
    """Prompt-safe summary of one Agent Soul config skill."""

    name: str
    description: str = ""
    size: int | None = None
    mime_type: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class DifyConfigFileConfig(BaseModel):
    """Prompt-safe summary of one Agent Soul config file."""

    name: str
    size: int | None = None
    mime_type: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class DifyConfigLayerConfig(LayerConfig):
    """Agent Soul config context plus eager-pull instructions for prompt mentions."""

    agent_id: str | None = None
    config_version: DifyConfigVersionConfig | None = None
    skills: list[DifyConfigSkillConfig] = Field(default_factory=list)
    files: list[DifyConfigFileConfig] = Field(default_factory=list)
    env_keys: list[str] = Field(default_factory=list)
    note: str = ""
    mentioned_skill_names: list[str] = Field(default_factory=list)
    mentioned_file_names: list[str] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class DifyConfigRuntimeState(BaseModel):
    """Serializable config-layer values computed once during context entry."""

    pulled_skill_outputs: dict[str, str] = Field(default_factory=dict)
    pulled_file_outputs: dict[str, str] = Field(default_factory=dict)
    config_context_json: str = ""
    config_cli_help: dict[str, str] = Field(default_factory=dict)
    push_spec_semantics: str = ""
    push_spec_json_schema: str = ""
    push_spec_example: str = ""

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", validate_assignment=True)


__all__ = [
    "DIFY_CONFIG_LAYER_TYPE_ID",
    "DifyConfigFileConfig",
    "DifyConfigLayerConfig",
    "DifyConfigRuntimeState",
    "DifyConfigSkillConfig",
    "DifyConfigVersionConfig",
]
