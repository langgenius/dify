from abc import ABC
from collections.abc import Mapping, Sequence
from enum import Enum, StrEnum
from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, Field, field_serializer, field_validator


class PromptMessageRole(Enum):
    """
    Enum class for prompt message.
    """

    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"

    @classmethod
    def value_of(cls, value: str) -> "PromptMessageRole":
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f"invalid prompt message type value {value}")


class PromptMessageTool(BaseModel):
    """
    Model class for prompt message tool.
    """

    name: str
    description: str
    parameters: dict


class PromptMessageFunction(BaseModel):
    """
    Model class for prompt message function.
    """

    type: str = "function"
    function: PromptMessageTool


class PromptMessageContentType(StrEnum):
    """
    Enum class for prompt message content type.
    """

    TEXT = "text"
    IMAGE = "image"
    AUDIO = "audio"
    VIDEO = "video"
    DOCUMENT = "document"


class PromptMessageContent(ABC, BaseModel):
    """
    Model class for prompt message content.
    """

    type: PromptMessageContentType


class TextPromptMessageContent(PromptMessageContent):
    """
    Model class for text prompt message content.
    """

    type: Literal[PromptMessageContentType.TEXT] = PromptMessageContentType.TEXT
    data: str


class MultiModalPromptMessageContent(PromptMessageContent):
    """
    Model class for multi-modal prompt message content.
    """

    format: str = Field(default=..., description="the format of multi-modal file")
    base64_data: str = Field(default="", description="the base64 data of multi-modal file")
    url: str = Field(default="", description="the url of multi-modal file")
    mime_type: str = Field(default=..., description="the mime type of multi-modal file")

    @property
    def data(self):
        return self.url or f"data:{self.mime_type};base64,{self.base64_data}"


class VideoPromptMessageContent(MultiModalPromptMessageContent):
    type: Literal[PromptMessageContentType.VIDEO] = PromptMessageContentType.VIDEO


class AudioPromptMessageContent(MultiModalPromptMessageContent):
    type: Literal[PromptMessageContentType.AUDIO] = PromptMessageContentType.AUDIO


class ImagePromptMessageContent(MultiModalPromptMessageContent):
    """
    Model class for image prompt message content.
    """

    class DETAIL(StrEnum):
        LOW = "low"
        HIGH = "high"

    type: Literal[PromptMessageContentType.IMAGE] = PromptMessageContentType.IMAGE
    detail: DETAIL = DETAIL.LOW


class DocumentPromptMessageContent(MultiModalPromptMessageContent):
    type: Literal[PromptMessageContentType.DOCUMENT] = PromptMessageContentType.DOCUMENT


PromptMessageContentUnionTypes = Annotated[
    Union[
        TextPromptMessageContent,
        ImagePromptMessageContent,
        DocumentPromptMessageContent,
        AudioPromptMessageContent,
        VideoPromptMessageContent,
    ],
    Field(discriminator="type"),
]


CONTENT_TYPE_MAPPING: Mapping[PromptMessageContentType, type[PromptMessageContent]] = {
    PromptMessageContentType.TEXT: TextPromptMessageContent,
    PromptMessageContentType.IMAGE: ImagePromptMessageContent,
    PromptMessageContentType.AUDIO: AudioPromptMessageContent,
    PromptMessageContentType.VIDEO: VideoPromptMessageContent,
    PromptMessageContentType.DOCUMENT: DocumentPromptMessageContent,
}


class PromptMessage(ABC, BaseModel):
    """
    Model class for prompt message.
    """

    role: PromptMessageRole
    content: Optional[str | list[PromptMessageContentUnionTypes]] = None
    name: Optional[str] = None

    def is_empty(self) -> bool:
        """
        Check if prompt message is empty.

        :return: True if prompt message is empty, False otherwise
        """
        return not self.content

    @field_validator("content", mode="before")
    @classmethod
    def validate_content(cls, v):
        if isinstance(v, list):
            prompts = []
            for prompt in v:
                if isinstance(prompt, PromptMessageContent):
                    if not isinstance(prompt, TextPromptMessageContent | MultiModalPromptMessageContent):
                        prompt = CONTENT_TYPE_MAPPING[prompt.type].model_validate(prompt.model_dump())
                elif isinstance(prompt, dict):
                    prompt = CONTENT_TYPE_MAPPING[prompt["type"]].model_validate(prompt)
                else:
                    raise ValueError(f"invalid prompt message {prompt}")
                prompts.append(prompt)
            return prompts
        return v

    @field_serializer("content")
    def serialize_content(
        self, content: Optional[Union[str, Sequence[PromptMessageContent]]]
    ) -> Optional[str | list[dict[str, Any] | PromptMessageContent] | Sequence[PromptMessageContent]]:
        if content is None or isinstance(content, str):
            return content
        if isinstance(content, list):
            return [item.model_dump() if hasattr(item, "model_dump") else item for item in content]
        return content


class UserPromptMessage(PromptMessage):
    """
    Model class for user prompt message.
    """

    role: PromptMessageRole = PromptMessageRole.USER


class AssistantPromptMessage(PromptMessage):
    """
    Model class for assistant prompt message.
    """

    class ToolCall(BaseModel):
        """
        Model class for assistant prompt message tool call.
        """

        class ToolCallFunction(BaseModel):
            """
            Model class for assistant prompt message tool call function.
            """

            name: str
            arguments: str

        id: str
        type: str
        function: ToolCallFunction

        @field_validator("id", mode="before")
        @classmethod
        def transform_id_to_str(cls, value) -> str:
            if not isinstance(value, str):
                return str(value)
            else:
                return value

    role: PromptMessageRole = PromptMessageRole.ASSISTANT
    tool_calls: list[ToolCall] = []

    def is_empty(self) -> bool:
        """
        Check if prompt message is empty.

        :return: True if prompt message is empty, False otherwise
        """
        if not super().is_empty() and not self.tool_calls:
            return False

        return True


class SystemPromptMessage(PromptMessage):
    """
    Model class for system prompt message.
    """

    role: PromptMessageRole = PromptMessageRole.SYSTEM


class ToolPromptMessage(PromptMessage):
    """
    Model class for tool prompt message.
    """

    role: PromptMessageRole = PromptMessageRole.TOOL
    tool_call_id: str

    def is_empty(self) -> bool:
        """
        Check if prompt message is empty.

        :return: True if prompt message is empty, False otherwise
        """
        if not super().is_empty() and not self.tool_call_id:
            return False

        return True
