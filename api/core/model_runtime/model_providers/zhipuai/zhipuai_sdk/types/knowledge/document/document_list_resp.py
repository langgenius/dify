from __future__ import annotations

from typing import Dict, Optional, List

from . import DocumentData
from ....core import BaseModel

__all__ = [
    "DocumentPage"
]


class DocumentPage(BaseModel):
    list: List[DocumentData]
    object: str
