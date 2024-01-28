from typing import List, Optional

from pydantic import BaseModel

__all__ = [
    "ChatCompletionChunk",
    "Choice",
    "ChoiceDelta",
    "ChoiceDeltaFunctionCall",
    "ChoiceDeltaToolCall",
    "ChoiceDeltaToolCallFunction",
]


class ChoiceDeltaFunctionCall(BaseModel):
    arguments: Optional[str] = None
    name: Optional[str] = None


class ChoiceDeltaToolCallFunction(BaseModel):
    arguments: Optional[str] = None
    name: Optional[str] = None


class ChoiceDeltaToolCall(BaseModel):
    index: int
    id: Optional[str] = None
    function: Optional[ChoiceDeltaToolCallFunction] = None
    type: Optional[str] = None


class ChoiceDelta(BaseModel):
    content: Optional[str] = None
    role: Optional[str] = None
    tool_calls: Optional[List[ChoiceDeltaToolCall]] = None


class Choice(BaseModel):
    delta: ChoiceDelta
    finish_reason: Optional[str] = None
    index: int


class CompletionUsage(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ChatCompletionChunk(BaseModel):
    id: Optional[str] = None
    choices: List[Choice]
    created: Optional[int] = None
    model: Optional[str] = None
    usage: Optional[CompletionUsage] = None
