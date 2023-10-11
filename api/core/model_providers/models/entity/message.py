import enum

from langchain.schema import HumanMessage, AIMessage, SystemMessage, BaseMessage, FunctionMessage
from pydantic import BaseModel


class LLMRunResult(BaseModel):
    content: str
    prompt_tokens: int
    completion_tokens: int
    source: list = None
    function_call: dict = None


class MessageType(enum.Enum):
    HUMAN = 'human'
    ASSISTANT = 'assistant'
    SYSTEM = 'system'


class PromptMessage(BaseModel):
    type: MessageType = MessageType.HUMAN
    content: str = ''
    function_call: dict = None


def to_lc_messages(messages: list[PromptMessage]):
    lc_messages = []
    for message in messages:
        if message.type == MessageType.HUMAN:
            lc_messages.append(HumanMessage(content=message.content))
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
            prompt_messages.append(PromptMessage(content=message.content, type=MessageType.HUMAN))
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
            prompt_messages.append(PromptMessage(content=message.content, type=MessageType.HUMAN))
    return prompt_messages


def str_to_prompt_messages(texts: list[str]):
    prompt_messages = []
    for text in texts:
        prompt_messages.append(PromptMessage(content=text))
    return prompt_messages
