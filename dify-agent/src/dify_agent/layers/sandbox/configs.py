"""Client-safe DTOs for the deployment-selected Sandbox Layer."""

from typing import ClassVar, Final

from agenton.layers import LayerConfig
from pydantic import BaseModel, ConfigDict

DIFY_SANDBOX_LAYER_TYPE_ID: Final[str] = "dify.sandbox"


class DifySandboxLayerConfig(LayerConfig):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class DifySandboxRuntimeState(BaseModel):
    handle: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", validate_assignment=True)


__all__ = ["DIFY_SANDBOX_LAYER_TYPE_ID", "DifySandboxLayerConfig", "DifySandboxRuntimeState"]
