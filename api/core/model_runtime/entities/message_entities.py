from abc import ABC
from collections.abc import Mapping, Sequence
from enum import StrEnum, auto
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field, field_serializer, field_validator


class PromptMessageRole(StrEnum):
    """
    Enum class for prompt message.
    """

    SYSTEM = auto()
    USER = auto()
    ASSISTANT = auto()
    TOOL = auto()

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

    TEXT = auto()
    IMAGE = auto()
    AUDIO = auto()
    VIDEO = auto()
    DOCUMENT = auto()


class PromptMessageContent(ABC, BaseModel):
    """
    Model class for prompt message content.
    """

    type: PromptMessageContentType


class TextPromptMessageContent(PromptMessageContent):
    """
    Model class for text prompt message content.
    """

    type: Literal[PromptMessageContentType.TEXT] = PromptMessageContentType.TEXT  # type: ignore
    data: str


class MultiModalPromptMessageContent(PromptMessageContent):
    """
    Model class for multi-modal prompt message content.
    """

    format: str = Field(default=..., description="the format of multi-modal file")
    base64_data: str = Field(default="", description="the base64 data of multi-modal file")
    url: str = Field(default="", description="the url of multi-modal file")
    mime_type: str = Field(default=..., description="the mime type of multi-modal file")
    filename: str = Field(default="", description="the filename of multi-modal file")

    @property
    def data(self):
        return self.url or f"data:{self.mime_type};base64,{self.base64_data}"


class VideoPromptMessageContent(MultiModalPromptMessageContent):
    type: Literal[PromptMessageContentType.VIDEO] = PromptMessageContentType.VIDEO  # type: ignore


class AudioPromptMessageContent(MultiModalPromptMessageContent):
    type: Literal[PromptMessageContentType.AUDIO] = PromptMessageContentType.AUDIO  # type: ignore


class ImagePromptMessageContent(MultiModalPromptMessageContent):
    """
    Model class for image prompt message content.
    """

    class DETAIL(StrEnum):
        LOW = auto()
        HIGH = auto()

    type: Literal[PromptMessageContentType.IMAGE] = PromptMessageContentType.IMAGE  # type: ignore
    detail: DETAIL = DETAIL.LOW


class DocumentPromptMessageContent(MultiModalPromptMessageContent):
    type: Literal[PromptMessageContentType.DOCUMENT] = PromptMessageContentType.DOCUMENT  # type: ignore


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
    content: str | list[PromptMessageContentUnionTypes] | None = None
    name: str | None = None

    def is_empty(self) -> bool:
        """
        Check if prompt message is empty.

        :return: True if prompt message is empty, False otherwise
        """
        return not self.content

    def get_text_content(self) -> str:
        """
        Get text content from prompt message.

        :return: Text content as string, empty string if no text content
        """
        if isinstance(self.content, str):
            return self.content
        elif isinstance(self.content, list):
            text_parts = []
            for item in self.content:
                if isinstance(item, TextPromptMessageContent):
                    text_parts.append(item.data)
            return "".join(text_parts)
        else:
            return ""

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
        self, content: Union[str, Sequence[PromptMessageContent]] | None
    ) -> str | list[dict[str, Any] | PromptMessageContent] | Sequence[PromptMessageContent] | None:
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
