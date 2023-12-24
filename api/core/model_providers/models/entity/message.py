import enum
from typing import Any, cast

from langchain.schema import HumanMessage, AIMessage, SystemMessage, BaseMessage, FunctionMessage
from pydantic import BaseModel

from core.model_runtime.entities.message_entities import PromptMessage, UserPromptMessage, TextPromptMessageContent, \
    ImagePromptMessageContent, AssistantPromptMessage, SystemPromptMessage, ToolPromptMessage


class MessageType(enum.Enum):
    USER = 'user'
    ASSISTANT = 'assistant'
    SYSTEM = 'system'


class PromptMessageFileType(enum.Enum):
    IMAGE = 'image'

    @staticmethod
    def value_of(value):
        for member in PromptMessageFileType:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class PromptMessageFile(BaseModel):
    type: PromptMessageFileType
    data: Any


class ImagePromptMessageFile(PromptMessageFile):
    class DETAIL(enum.Enum):
        LOW = 'low'
        HIGH = 'high'

    type: PromptMessageFileType = PromptMessageFileType.IMAGE
    detail: DETAIL = DETAIL.LOW


class LCHumanMessageWithFiles(HumanMessage):
    # content: Union[str, List[Union[str, Dict]]]
    content: str
    files: list[PromptMessageFile]


def to_prompt_messages(messages: list[BaseMessage]) -> list[PromptMessage]:
    prompt_messages = []
    for message in messages:
        if isinstance(message, HumanMessage):
            if isinstance(message, LCHumanMessageWithFiles):
                file_prompt_message_contents = []
                for file in message.files:
                    if file.type == PromptMessageFileType.IMAGE:
                        file = cast(ImagePromptMessageFile, file)
                        file_prompt_message_contents.append(ImagePromptMessageContent(
                            data=file.data,
                            detail=ImagePromptMessageContent.DETAIL.HIGH
                            if file.detail.value == "high" else ImagePromptMessageContent.DETAIL.LOW
                        ))

                prompt_message_contents = [TextPromptMessageContent(data=message.content)]
                prompt_message_contents.extend(file_prompt_message_contents)

                prompt_messages.append(UserPromptMessage(content=prompt_message_contents))
            else:
                prompt_messages.append(UserPromptMessage(content=message.content))
        elif isinstance(message, AIMessage):
            message_kwargs = {
                'content': message.content
            }

            if 'function_call' in message.additional_kwargs:
                message_kwargs['tool_calls'] = [message.additional_kwargs['function_call']]

            prompt_messages.append(AssistantPromptMessage(**message_kwargs))
        elif isinstance(message, SystemMessage):
            prompt_messages.append(SystemPromptMessage(content=message.content))
        elif isinstance(message, FunctionMessage):
            prompt_messages.append(ToolPromptMessage(content=message.content, tool_call_id=message.name))

    return prompt_messages


def str_to_prompt_messages(texts: list[str]):
    prompt_messages = []
    for text in texts:
        prompt_messages.append(PromptMessage(content=text))
    return prompt_messages
