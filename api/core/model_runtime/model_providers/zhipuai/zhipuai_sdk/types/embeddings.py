from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel

from .chat.chat_completion import CompletionUsage

__all__ = ["Embedding", "EmbeddingsResponded"]


class Embedding(BaseModel):
    object: str
    index: Optional[int] = None
    embedding: List[float]


class EmbeddingsResponded(BaseModel):
    object: str
    data: List[Embedding]
    model: str
    usage: CompletionUsage
