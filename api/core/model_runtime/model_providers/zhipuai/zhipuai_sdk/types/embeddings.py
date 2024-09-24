from __future__ import annotations

from typing import Optional

from ..core import BaseModel
from .chat.chat_completion import CompletionUsage

__all__ = ["Embedding", "EmbeddingsResponded"]


class Embedding(BaseModel):
    object: str
    index: Optional[int] = None
    embedding: list[float]


class EmbeddingsResponded(BaseModel):
    object: str
    data: list[Embedding]
    model: str
    usage: CompletionUsage
