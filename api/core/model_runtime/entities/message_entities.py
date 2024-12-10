from abc import ABC
from collections.abc import Sequence
from enum import Enum, StrEnum
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


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


class PromptMessageContent(BaseModel):
    """
    Model class for prompt message content.
    """

    type: PromptMessageContentType
    data: str


class TextPromptMessageContent(PromptMessageContent):
    """
    Model class for text prompt message content.
    """

    type: PromptMessageContentType = PromptMessageContentType.TEXT


class VideoPromptMessageContent(PromptMessageContent):
    type: PromptMessageContentType = PromptMessageContentType.VIDEO
    data: str = Field(..., description="Base64 encoded video data")
    format: str = Field(..., description="Video format")


class AudioPromptMessageContent(PromptMessageContent):
    type: PromptMessageContentType = PromptMessageContentType.AUDIO
    data: str = Field(..., description="Base64 encoded audio data")
    format: str = Field(..., description="Audio format")


class ImagePromptMessageContent(PromptMessageContent):
    """
    Model class for image prompt message content.
    """

    class DETAIL(StrEnum):
        LOW = "low"
        HIGH = "high"

    type: PromptMessageContentType = PromptMessageContentType.IMAGE
    detail: DETAIL = DETAIL.LOW
    format: str = Field("jpg", description="Image format")


class DocumentPromptMessageContent(PromptMessageContent):
    type: PromptMessageContentType = PromptMessageContentType.DOCUMENT
    encode_format: Literal["base64"]
    data: str
    format: str = Field(..., description="Document format")


class PromptMessage(ABC, BaseModel):
    """
    Model class for prompt message.
    """

    role: PromptMessageRole
    content: Optional[str | Sequence[PromptMessageContent]] = None
    name: Optional[str] = None

    def is_empty(self) -> bool:
        """
        Check if prompt message is empty.

        :return: True if prompt message is empty, False otherwise
        """
        return not self.content


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
