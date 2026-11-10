"""Client-safe config for operation-scoped RuntimeLease acquisition."""

from typing import ClassVar

from pydantic import BaseModel, ConfigDict, Field


class DifyRuntimeLayerConfig(BaseModel):
    backend_binding_ref: str = Field(min_length=1)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = ["DifyRuntimeLayerConfig"]
