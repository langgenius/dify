"""Client-safe DTOs for the Dify sandbox shell layer.

The shell layer owns resumable sandbox workspace state only: a stable layer type
id plus an intentionally empty public config schema. Runtime command execution
and workspace lifecycle live in ``dify_agent.layers.shell.layer`` so importing
this module stays safe for API-side request building.
"""

from typing import ClassVar, Final

from pydantic import ConfigDict

from agenton.layers import LayerConfig


DIFY_SHELL_LAYER_TYPE_ID: Final[str] = "dify.shell"


class DifyShellLayerConfig(LayerConfig):
    """Public config for the sandbox shell layer.

    The first version keeps shell entry configuration server-defined so callers
    only opt into the conventional shell layer by type id and node name.
    """

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = ["DIFY_SHELL_LAYER_TYPE_ID", "DifyShellLayerConfig"]
