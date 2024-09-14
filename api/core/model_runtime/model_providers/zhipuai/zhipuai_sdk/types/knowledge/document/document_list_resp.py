from __future__ import annotations

from ....core import BaseModel
from . import DocumentData

__all__ = ["DocumentPage"]


class DocumentPage(BaseModel):
    list: list[DocumentData]
    object: str
