import enum
from typing import Any, cast, Union, List, Dict

from langchain.schema import HumanMessage, AIMessage, SystemMessage, BaseMessage, FunctionMessage
from pydantic import BaseModel


class LLMRunResult(BaseModel):
    content: str
    prompt_tokens: int
    completion_tokens: int
    source: list = None
    function_call: dict = None


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


class PromptMessage(BaseModel):
    type: MessageType = MessageType.USER
    content: str = ''
    files: list[PromptMessageFile] = []
    function_call: dict = None


class LCHumanMessageWithFiles(HumanMessage):
    # content: Union[str, List[Union[str, Dict]]]
    content: str
    files: list[PromptMessageFile]


def to_lc_messages(messages: list[PromptMessage]):
    lc_messages = []
    for message in messages:
        if message.type == MessageType.USER:
            if not message.files:
                lc_messages.append(HumanMessage(content=message.content))
            else:
                lc_messages.append(LCHumanMessageWithFiles(content=message.content, files=message.files))
        elif message.type == MessageType.ASSISTANT:
            additional_kwargs = {}
            if message.function_call:
                additional_kwargs['function_call'] = message.function_call
            lc_messages.append(AIMessage(content=message.content, additional_kwargs=additional_kwargs))
        elif message.type == MessageType.SYSTEM:
            lc_messages.append(SystemMessage(content=message.content))

    return lc_messages


def to_prompt_messages(messages: list[BaseMessage]):
    prompt_messages = []
    for message in messages:
        if isinstance(message, HumanMessage):
            if isinstance(message, LCHumanMessageWithFiles):
                prompt_messages.append(PromptMessage(
                    content=message.content,
                    type=MessageType.USER,
                    files=message.files
                ))
            else:
                prompt_messages.append(PromptMessage(content=message.content, type=MessageType.USER))
        elif isinstance(message, AIMessage):
            message_kwargs = {
                'content': message.content,
                'type': MessageType.ASSISTANT
            }

            if 'function_call' in message.additional_kwargs:
                message_kwargs['function_call'] = message.additional_kwargs['function_call']

            prompt_messages.append(PromptMessage(**message_kwargs))
        elif isinstance(message, SystemMessage):
            prompt_messages.append(PromptMessage(content=message.content, type=MessageType.SYSTEM))
        elif isinstance(message, FunctionMessage):
            prompt_messages.append(PromptMessage(content=message.content, type=MessageType.USER))
    return prompt_messages


def str_to_prompt_messages(texts: list[str]):
    prompt_messages = []
    for text in texts:
        prompt_messages.append(PromptMessage(content=text))
    return prompt_messages
