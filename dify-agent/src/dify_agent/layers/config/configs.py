"""Client-safe DTOs for the Dify config declaration layer."""

from typing import Final

from pydantic import BaseModel, ConfigDict, Field

from agenton.layers import LayerConfig


DIFY_CONFIG_LAYER_TYPE_ID: Final[str] = "dify.config"


class DifyConfigSkillConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    description: str


class DifyConfigFileConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str


class DifyConfigLayerConfig(LayerConfig):
    """Runtime catalog plus eager-pull instructions for prompt-mentioned config assets."""

    skills: list[DifyConfigSkillConfig] = Field(default_factory=list)
    files: list[DifyConfigFileConfig] = Field(default_factory=list)
    env_keys: list[str] = Field(default_factory=list)
    note: str = ""
    mentioned_skill_names: list[str] = Field(default_factory=list)
    mentioned_file_names: list[str] = Field(default_factory=list)
    writable: bool = False


__all__ = [
    "DIFY_CONFIG_LAYER_TYPE_ID",
    "DifyConfigFileConfig",
    "DifyConfigLayerConfig",
    "DifyConfigSkillConfig",
]
