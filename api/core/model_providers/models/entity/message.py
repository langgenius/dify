import enum

from langchain.schema import HumanMessage, AIMessage, SystemMessage, BaseMessage
from pydantic import BaseModel


class LLMRunResult(BaseModel):
    content: str
    prompt_tokens: int
    completion_tokens: int
    source: list = None


class MessageType(enum.Enum):
    USER = 'user'
    ASSISTANT = 'assistant'
    SYSTEM = 'system'


class PromptMessage(BaseModel):
    type: MessageType = MessageType.USER
    content: str = ''


def to_lc_messages(messages: list[PromptMessage]):
    lc_messages = []
    for message in messages:
        if message.type == MessageType.USER:
            lc_messages.append(HumanMessage(content=message.content))
        elif message.type == MessageType.ASSISTANT:
            lc_messages.append(AIMessage(content=message.content))
        elif message.type == MessageType.SYSTEM:
            lc_messages.append(SystemMessage(content=message.content))

    return lc_messages


def to_prompt_messages(messages: list[BaseMessage]):
    prompt_messages = []
    for message in messages:
        if isinstance(message, HumanMessage):
            prompt_messages.append(PromptMessage(content=message.content, type=MessageType.USER))
        elif isinstance(message, AIMessage):
            prompt_messages.append(PromptMessage(content=message.content, type=MessageType.ASSISTANT))
        elif isinstance(message, SystemMessage):
            prompt_messages.append(PromptMessage(content=message.content, type=MessageType.SYSTEM))
    return prompt_messages


def str_to_prompt_messages(texts: list[str]):
    prompt_messages = []
    for text in texts:
        prompt_messages.append(PromptMessage(content=text))
    return prompt_messages
