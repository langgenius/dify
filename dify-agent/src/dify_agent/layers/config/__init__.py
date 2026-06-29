"""Client-safe exports for the Dify config runtime catalog DTOs."""

from dify_agent.layers.config.configs import (
    DIFY_CONFIG_LAYER_TYPE_ID,
    DifyConfigLayerConfig,
)

__all__ = [
    "DIFY_CONFIG_LAYER_TYPE_ID",
    "DifyConfigLayerConfig",
]
