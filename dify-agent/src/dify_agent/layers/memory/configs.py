"""Provider-neutral external memory invocation configuration."""

from typing import ClassVar, Literal, Self

from pydantic import ConfigDict, Field, model_validator

from agenton.layers import LayerConfig
from dify_agent.layers.dify_plugin.configs import DifyPluginToolConfig

DIFY_MEMORY_LAYER_TYPE_ID = "dify.external_memory"
DIFY_MEMORY_LAYER_ID = "external_memory"


class DifyMemoryLayerConfig(LayerConfig):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    prepare: DifyPluginToolConfig
    observe: DifyPluginToolConfig
    subject_kind: Literal["user", "business"] = "user"
    subject_id: str | None = Field(default=None, min_length=1, max_length=256)
    max_bytes: int = Field(default=8000, ge=512, le=32768)
    capture_max_bytes: int = Field(default=8192, ge=512, le=32768)
    capture: bool = True
    timeout: float = Field(default=10, gt=0, le=30)

    @model_validator(mode="after")
    def require_business_subject(self) -> Self:
        if self.subject_kind == "business" and not self.subject_id:
            raise ValueError("Business memory requires a configured subject_id")
        return self
