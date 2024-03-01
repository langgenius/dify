import enum
from typing import Any, cast

from langchain.schema import AIMessage, BaseMessage, FunctionMessage, HumanMessage, SystemMessage
from pydantic import BaseModel

from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessage,
    SystemPromptMessage,
    TextPromptMessageContent,
    ToolPromptMessage,
    UserPromptMessage,
)


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
    # content: Union[str, list[Union[str, Dict]]]
    content: str
    files: list[PromptMessageFile]


def lc_messages_to_prompt_messages(messages: list[BaseMessage]) -> list[PromptMessage]:
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
                message_kwargs['tool_calls'] = [
                    AssistantPromptMessage.ToolCall(
                        id=message.additional_kwargs['function_call']['id'],
                        type='function',
                        function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                            name=message.additional_kwargs['function_call']['name'],
                            arguments=message.additional_kwargs['function_call']['arguments']
                        )
                    )
                ]

            prompt_messages.append(AssistantPromptMessage(**message_kwargs))
        elif isinstance(message, SystemMessage):
            prompt_messages.append(SystemPromptMessage(content=message.content))
        elif isinstance(message, FunctionMessage):
            prompt_messages.append(ToolPromptMessage(content=message.content, tool_call_id=message.name))

    return prompt_messages


def prompt_messages_to_lc_messages(prompt_messages: list[PromptMessage]) -> list[BaseMessage]:
    messages = []
    for prompt_message in prompt_messages:
        if isinstance(prompt_message, UserPromptMessage):
            if isinstance(prompt_message.content, str):
                messages.append(HumanMessage(content=prompt_message.content))
            else:
                message_contents = []
                for content in prompt_message.content:
                    if isinstance(content, TextPromptMessageContent):
                        message_contents.append(content.data)
                    elif isinstance(content, ImagePromptMessageContent):
                        message_contents.append({
                            'type': 'image',
                            'data': content.data,
                            'detail': content.detail.value
                        })

                messages.append(HumanMessage(content=message_contents))
        elif isinstance(prompt_message, AssistantPromptMessage):
            message_kwargs = {
                'content': prompt_message.content
            }

            if prompt_message.tool_calls:
                message_kwargs['additional_kwargs'] = {
                    'function_call': {
                        'id': prompt_message.tool_calls[0].id,
                        'name': prompt_message.tool_calls[0].function.name,
                        'arguments': prompt_message.tool_calls[0].function.arguments
                    }
                }

            messages.append(AIMessage(**message_kwargs))
        elif isinstance(prompt_message, SystemPromptMessage):
            messages.append(SystemMessage(content=prompt_message.content))
        elif isinstance(prompt_message, ToolPromptMessage):
            messages.append(FunctionMessage(name=prompt_message.tool_call_id, content=prompt_message.content))

    return messages
