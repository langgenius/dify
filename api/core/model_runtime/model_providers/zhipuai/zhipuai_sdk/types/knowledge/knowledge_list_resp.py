from __future__ import annotations

from typing import Dict, Optional, List

from . import KnowledgeInfo
from ...core import BaseModel

__all__ = [
    "KnowledgePage"
]


class KnowledgePage(BaseModel):
    list: List[KnowledgeInfo]
    object: str
