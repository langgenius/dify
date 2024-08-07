from typing import Optional

from pydantic import BaseModel

from .chat_completion import CompletionChoice, CompletionUsage

__all__ = ["AsyncTaskStatus"]


class AsyncTaskStatus(BaseModel):
    id: Optional[str] = None
    request_id: Optional[str] = None
    model: Optional[str] = None
    task_status: Optional[str] = None


class AsyncCompletion(BaseModel):
    id: Optional[str] = None
    request_id: Optional[str] = None
    model: Optional[str] = None
    task_status: str
    choices: list[CompletionChoice]
    usage: CompletionUsage