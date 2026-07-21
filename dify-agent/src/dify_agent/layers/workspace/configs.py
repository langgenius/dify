"""Client-safe DTOs for the runtime-session workspace binding layer."""

from typing import ClassVar, Final

from agenton.layers import LayerConfig
from pydantic import BaseModel, ConfigDict, Field

DIFY_WORKSPACE_LAYER_TYPE_ID: Final[str] = "dify.workspace"


class DifyWorkspaceLayerConfig(LayerConfig):
    workspace_id: str = Field(min_length=1)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class DifyWorkspaceRuntimeState(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = ["DIFY_WORKSPACE_LAYER_TYPE_ID", "DifyWorkspaceLayerConfig", "DifyWorkspaceRuntimeState"]
