"""Client-safe DTOs for the Dify shell Agenton layer.

This first shell layer version intentionally has no public configuration beyond
its stable type id. Server-only shellctl connection settings are injected by the
runtime provider factory so client code cannot accidentally depend on process
environment or transport details.
"""

from typing import ClassVar, Final

from pydantic import ConfigDict

from agenton.layers import LayerConfig


DIFY_SHELL_LAYER_TYPE_ID: Final[str] = "dify.shell"


class DifyShellLayerConfig(LayerConfig):
    """Empty public config for the shellctl-backed Dify shell layer."""

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = ["DIFY_SHELL_LAYER_TYPE_ID", "DifyShellLayerConfig"]
