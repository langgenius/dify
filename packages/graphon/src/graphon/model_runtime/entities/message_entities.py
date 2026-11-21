from __future__ import annotations

from abc import ABC
from collections.abc import Mapping, Sequence
from enum import StrEnum, auto
from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, Field, field_serializer, field_validator


class PromptMessageRole(StrEnum):
    """Enum class for prompt message."""

    SYSTEM = auto()
    USER = auto()
    ASSISTANT = auto()
    TOOL = auto()

    @classmethod
    def value_of(cls, value: str) -> Self:
        """Get the enum member for a prompt message role.

        Args:
            value: Prompt message role value.

        Returns:
            The matching prompt message role.

        """
        return cls(value)


class PromptMessageTool(BaseModel):
    """Model class for prompt message tool."""

    name: str
    description: str
    parameters: dict


class PromptMessageFunction(BaseModel):
    """Model class for prompt message function."""

    type: str = "function"
    function: PromptMessageTool


class PromptMessageContentType(StrEnum):
    """Enum class for prompt message content type."""

    TEXT = auto()
    IMAGE = auto()
    AUDIO = auto()
    VIDEO = auto()
    DOCUMENT = auto()


class PromptMessageContent(ABC, BaseModel):
    """Model class for prompt message content."""

    type: PromptMessageContentType


class TextPromptMessageContent(PromptMessageContent):
    """Model class for text prompt message content."""

    type: Literal[PromptMessageContentType.TEXT] = PromptMessageContentType.TEXT
    data: str


class MultiModalPromptMessageContent(PromptMessageContent):
    """Model class for multi-modal prompt message content."""

    format: str = Field(default=..., description="the format of multi-modal file")
    base64_data: str = Field(
        default="",
        description="the base64 data of multi-modal file",
    )
    url: str = Field(default="", description="the url of multi-modal file")
    mime_type: str = Field(default=..., description="the mime type of multi-modal file")
    filename: str = Field(default="", description="the filename of multi-modal file")

    @property
    def data(self) -> str:
        return self.url or f"data:{self.mime_type};base64,{self.base64_data}"


class VideoPromptMessageContent(MultiModalPromptMessageContent):
    type: Literal[PromptMessageContentType.VIDEO] = PromptMessageContentType.VIDEO


class AudioPromptMessageContent(MultiModalPromptMessageContent):
    type: Literal[PromptMessageContentType.AUDIO] = PromptMessageContentType.AUDIO


class ImagePromptMessageContent(MultiModalPromptMessageContent):
    """Model class for image prompt message content."""

    class DETAIL(StrEnum):
        """Supported image detail levels."""

        LOW = auto()
        HIGH = auto()

    type: Literal[PromptMessageContentType.IMAGE] = PromptMessageContentType.IMAGE
    detail: DETAIL = DETAIL.LOW


class DocumentPromptMessageContent(MultiModalPromptMessageContent):
    type: Literal[PromptMessageContentType.DOCUMENT] = PromptMessageContentType.DOCUMENT


type PromptMessageContentUnionTypes = Annotated[
    TextPromptMessageContent
    | ImagePromptMessageContent
    | DocumentPromptMessageContent
    | AudioPromptMessageContent
    | VideoPromptMessageContent,
    Field(discriminator="type"),
]


CONTENT_TYPE_MAPPING: Mapping[PromptMessageContentType, type[PromptMessageContent]] = {
    PromptMessageContentType.TEXT: TextPromptMessageContent,
    PromptMessageContentType.IMAGE: ImagePromptMessageContent,
    PromptMessageContentType.AUDIO: AudioPromptMessageContent,
    PromptMessageContentType.VIDEO: VideoPromptMessageContent,
    PromptMessageContentType.DOCUMENT: DocumentPromptMessageContent,
}


def _get_text_prompt_message_data(item: PromptMessageContent) -> str:
    match item:
        case TextPromptMessageContent():
            result = item.data
        case _:
            result = ""
    return result


def _normalize_prompt_message_content(
    prompt: PromptMessageContent | dict[str, Any],
) -> PromptMessageContent:
    match prompt:
        case TextPromptMessageContent() | MultiModalPromptMessageContent():
            result = prompt
        case PromptMessageContent():
            result = CONTENT_TYPE_MAPPING[prompt.type].model_validate(
                prompt.model_dump(),
            )
        case {"type": prompt_type, **rest}:
            _ = rest
            result = CONTENT_TYPE_MAPPING[prompt_type].model_validate(prompt)
        case _:
            msg = f"invalid prompt message {prompt}"
            raise ValueError(msg)
    return result


def _serialize_prompt_message_content_item(
    item: PromptMessageContent | dict[str, Any],
) -> dict[str, Any] | PromptMessageContent:
    match item:
        case PromptMessageContent():
            result = item.model_dump()
        case _:
            result = item
    return result


class PromptMessage(ABC, BaseModel):
    """Model class for prompt message."""

    role: PromptMessageRole
    content: str | list[PromptMessageContentUnionTypes] | None = None
    name: str | None = None

    def is_empty(self) -> bool:
        """Check whether the prompt message has any content."""
        return not self.content

    def get_text_content(self) -> str:
        """Extract text-only content from the prompt message."""
        match self.content:
            case str():
                result = self.content
            case list():
                result = "".join(
                    _get_text_prompt_message_data(item) for item in self.content
                )
            case _:
                result = ""
        return result

    @field_validator("content", mode="before")
    @classmethod
    def validate_content(cls, v: Any) -> Any:
        match v:
            case list():
                result = [_normalize_prompt_message_content(prompt) for prompt in v]
            case _:
                result = v
        return result

    @field_serializer("content")
    def serialize_content(
        self,
        content: str | Sequence[PromptMessageContent] | None,
    ) -> (
        str
        | list[dict[str, Any] | PromptMessageContent]
        | Sequence[PromptMessageContent]
        | None
    ):
        match content:
            case None | str():
                result = content
            case list():
                result = [
                    _serialize_prompt_message_content_item(item) for item in content
                ]
            case _:
                result = content
        return result


class UserPromptMessage(PromptMessage):
    """Model class for user prompt message."""

    role: PromptMessageRole = PromptMessageRole.USER


class AssistantPromptMessage(PromptMessage):
    """Model class for assistant prompt message."""

    class ToolCall(BaseModel):
        """Model class for assistant prompt message tool call."""

        class ToolCallFunction(BaseModel):
            """Model class for assistant prompt message tool call function."""

            name: str
            arguments: str

        id: str
        type: str
        function: ToolCallFunction

        @field_validator("id", mode="before")
        @classmethod
        def transform_id_to_str(cls, value: Any) -> str:
            match value:
                case str():
                    result = value
                case _:
                    result = str(value)
            return result

    role: PromptMessageRole = PromptMessageRole.ASSISTANT
    tool_calls: list[ToolCall] = []

    def is_empty(self) -> bool:
        """Check whether the assistant message has no content or tool calls."""
        return super().is_empty() and not self.tool_calls


class SystemPromptMessage(PromptMessage):
    """Model class for system prompt message."""

    role: PromptMessageRole = PromptMessageRole.SYSTEM


class ToolPromptMessage(PromptMessage):
    """Model class for tool prompt message."""

    role: PromptMessageRole = PromptMessageRole.TOOL
    tool_call_id: str

    def is_empty(self) -> bool:
        """Check whether the tool message has no content or tool call id."""
        return super().is_empty() and not self.tool_call_id
