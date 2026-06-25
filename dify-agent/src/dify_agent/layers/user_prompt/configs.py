"""Serializable user prompt layer DTOs for Agent App chat turns."""

from typing import ClassVar, Final, Literal

from pydantic import BaseModel, ConfigDict, Field

from agenton.layers import LayerConfig


DIFY_USER_PROMPT_LAYER_TYPE_ID: Final[str] = "dify.user_prompt"


class DifyUserPromptFileConfig(BaseModel):
    """One user-uploaded file carried inline to the agent backend."""

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    filename: str
    mime_type: str
    format: str
    type: Literal["image", "document", "audio", "video", "custom"]
    base64_data: str
    detail: Literal["low", "high"] | None = None


class DifyUserPromptLayerConfig(LayerConfig):
    """User prompt text plus optional multimodal files."""

    text: str
    files: list[DifyUserPromptFileConfig] = Field(default_factory=list)


__all__ = [
    "DIFY_USER_PROMPT_LAYER_TYPE_ID",
    "DifyUserPromptFileConfig",
    "DifyUserPromptLayerConfig",
]
