from typing import Optional

from pydantic import BaseModel

__all__ = ["Completion", "CompletionUsage"]


class Function(BaseModel):
    arguments: str
    name: str


class CompletionMessageToolCall(BaseModel):
    id: str
    function: Function
    type: str


class CompletionMessage(BaseModel):
    content: Optional[str] = None
    role: str
    tool_calls: Optional[list[CompletionMessageToolCall]] = None


class CompletionUsage(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class CompletionChoice(BaseModel):
    index: int
    finish_reason: str
    message: CompletionMessage


class Completion(BaseModel):
    model: Optional[str] = None
    created: Optional[int] = None
    choices: list[CompletionChoice]
    request_id: Optional[str] = None
    id: Optional[str] = None
    usage: CompletionUsage


