"""Client-safe exports for the Dify structured output layer DTOs.

The runtime layer implementation lives in ``output_layer.py`` and imports
server-side execution dependencies. Keep this package root import-safe for
client code that only needs to build run requests.
"""

from dify_agent.layers.output.configs import DIFY_OUTPUT_LAYER_TYPE_ID, DifyOutputLayerConfig

__all__ = ["DIFY_OUTPUT_LAYER_TYPE_ID", "DifyOutputLayerConfig"]
