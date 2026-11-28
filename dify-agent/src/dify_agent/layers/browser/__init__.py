"""Client-safe exports for the Dify browser layer DTOs.

The runtime layer implementation lives in ``layer.py`` and consumes a
server-injected active Runtime lease. Keep this package root import-safe for
client code that only needs to build run requests.
"""

from dify_agent.layers.browser.configs import DifyBrowserLayerConfig

__all__ = [
    "DifyBrowserLayerConfig",
]
