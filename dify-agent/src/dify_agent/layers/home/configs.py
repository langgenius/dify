"""Client-safe DTOs for the immutable Home Snapshot binding layer."""

from typing import ClassVar, Final

from agenton.layers import LayerConfig
from pydantic import BaseModel, ConfigDict, Field

DIFY_HOME_LAYER_TYPE_ID: Final[str] = "dify.home"


class DifyHomeLayerConfig(LayerConfig):
    snapshot_ref: str = Field(min_length=1)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class DifyHomeRuntimeState(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = ["DIFY_HOME_LAYER_TYPE_ID", "DifyHomeLayerConfig", "DifyHomeRuntimeState"]
