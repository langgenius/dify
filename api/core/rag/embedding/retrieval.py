from typing import Optional

from pydantic import BaseModel

from models.dataset import ChildChunk, DocumentSegment


class RetrievalSegments(BaseModel):
    """Retrieval segments."""
    model_config = {
        "arbitrary_types_allowed": True
    }
    segment: DocumentSegment
    child_chunks: Optional[list[ChildChunk]] = None
    score: Optional[float] = None
