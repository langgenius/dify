"""Runtime layer that turns serialized Agent App user files into pydantic-ai content."""

from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import ClassVar

from pydantic_ai.messages import BinaryContent, UserContent
from typing_extensions import Self, override

from agenton.layers import EmptyRuntimeState, NoLayerDeps, PydanticAILayer
from dify_agent.layers.user_prompt.configs import (
    DIFY_USER_PROMPT_LAYER_TYPE_ID,
    DifyUserPromptFileConfig,
    DifyUserPromptLayerConfig,
)


@dataclass(slots=True)
class DifyUserPromptLayer(PydanticAILayer[NoLayerDeps, object, DifyUserPromptLayerConfig, EmptyRuntimeState]):
    """State-free pydantic-ai layer for text and uploaded user files."""

    type_id: ClassVar[str | None] = DIFY_USER_PROMPT_LAYER_TYPE_ID

    config: DifyUserPromptLayerConfig

    @classmethod
    @override
    def from_config(cls, config: DifyUserPromptLayerConfig) -> Self:
        """Create the layer from validated public config."""
        return cls(config=DifyUserPromptLayerConfig.model_validate(config))

    @property
    @override
    def user_prompts(self) -> list[UserContent]:
        if not self.config.files:
            return [self.config.text]

        parts: list[UserContent] = []
        for file in self.config.files:
            parts.append(_file_to_binary_content(file))
        if self.config.text:
            parts.append(self.config.text)
        return parts


def _file_to_binary_content(file: DifyUserPromptFileConfig) -> BinaryContent:
    metadata: dict[str, str] = {"filename": file.filename}
    if file.detail:
        metadata["detail"] = file.detail
    return BinaryContent(
        data=base64.b64decode(file.base64_data),
        media_type=file.mime_type,
        identifier=_identifier_from_filename(file.filename, file.format),
        vendor_metadata=metadata,
    )


def _identifier_from_filename(filename: str, file_format: str) -> str:
    suffix = f".{file_format}" if file_format else ""
    if suffix and filename.lower().endswith(suffix.lower()):
        return filename[: -len(suffix)] or "file"
    return filename or "file"


__all__ = ["DifyUserPromptLayer"]
