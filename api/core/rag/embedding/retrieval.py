from pydantic import BaseModel
from typing_extensions import TypedDict

from models.dataset import DocumentSegment


class AttachmentInfoDict(TypedDict):
    id: str
    name: str
    extension: str
    mime_type: str
    source_url: str
    size: int


class RetrievalChildChunk(BaseModel):
    """Retrieval segments."""

    id: str
    content: str
    score: float
    position: int


class RetrievalSegments(BaseModel):
    """Retrieval segments."""

    model_config = {"arbitrary_types_allowed": True}
    segment: DocumentSegment
    child_chunks: list[RetrievalChildChunk] | None = None
    score: float | None = None
    files: list[AttachmentInfoDict] | None = None
    summary: str | None = None  # Summary content if retrieved via summary index
