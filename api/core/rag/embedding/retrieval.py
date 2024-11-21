from typing import Optional

from pydantic import BaseModel

from models.dataset import ChildChunk, DocumentSegment


class RetrievalSegments(BaseModel):
    """Retrieval segments."""

    segment: DocumentSegment
    child_chunks: Optional[list[ChildChunk]] = None
    score: Optional[float] = None
