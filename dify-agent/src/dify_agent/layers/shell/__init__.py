"""Client-safe exports for the Dify sandbox shell layer DTOs.

The runtime shell implementation lives in ``layer.py`` because it depends on
server-side filesystem and subprocess execution details. Keep the package root
import-safe so API code can build compositions without importing execution code.
"""

from dify_agent.layers.shell.configs import DIFY_SHELL_LAYER_TYPE_ID, DifyShellLayerConfig

__all__ = ["DIFY_SHELL_LAYER_TYPE_ID", "DifyShellLayerConfig"]
