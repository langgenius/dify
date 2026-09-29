"""Client-safe config for operation-scoped RuntimeLease acquisition."""

from typing import ClassVar, Final

from agenton.layers import LayerConfig
from pydantic import ConfigDict, Field

DIFY_RUNTIME_LAYER_TYPE_ID: Final[str] = "dify.runtime"


class DifyRuntimeLayerConfig(LayerConfig):
    backend_binding_ref: str = Field(min_length=1)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = ["DIFY_RUNTIME_LAYER_TYPE_ID", "DifyRuntimeLayerConfig"]
