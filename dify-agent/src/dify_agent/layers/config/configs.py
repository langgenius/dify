"""Client-safe DTOs for the Dify config declaration layer."""

from typing import Final

from pydantic import Field

from agenton.layers import LayerConfig


DIFY_CONFIG_LAYER_TYPE_ID: Final[str] = "dify.config"


class DifyConfigLayerConfig(LayerConfig):
    """Eager-pull instructions for prompt-mentioned config assets."""

    mentioned_skill_names: list[str] = Field(default_factory=list)
    mentioned_file_names: list[str] = Field(default_factory=list)


__all__ = [
    "DIFY_CONFIG_LAYER_TYPE_ID",
    "DifyConfigLayerConfig",
]
