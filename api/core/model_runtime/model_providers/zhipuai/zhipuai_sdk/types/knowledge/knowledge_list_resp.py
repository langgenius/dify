from __future__ import annotations

from ...core import BaseModel
from . import KnowledgeInfo

__all__ = ["KnowledgePage"]


class KnowledgePage(BaseModel):
    list: list[KnowledgeInfo]
    object: str
