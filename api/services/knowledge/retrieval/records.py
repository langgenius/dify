from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from pydantic import BaseModel

from core.rag.models.document import Document
from models.dataset import DocumentSegment
from models.model import UploadFile
from services.knowledge.entities.retrieval import (
    AttachmentInfoDict,
    RetrievedAttachment,
    RetrievedTraceDocument,
    Source,
)


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


@dataclass(frozen=True, slots=True)
class FinalizedInternalRetrieval:
    """A persisted retrieval record whose access and presentation are published."""

    record: RetrievalSegments
    attachments: tuple[UploadFile, ...]
    content: str
    files: tuple[AttachmentInfoDict, ...]

    @property
    def score(self) -> float:
        return float(self.record.score or 0.0)

    def trace_document(self) -> Document:
        segment = self.record.segment
        return Document(
            page_content=segment.content,
            provider="dify",
            metadata={
                "dataset_id": segment.dataset_id,
                "document_id": segment.document_id,
                "doc_id": segment.index_node_id or segment.id,
                "segment_id": segment.id,
                "score": self.record.score,
            },
        )


type FinalizedRetrievalItem = Document | FinalizedInternalRetrieval


@dataclass(frozen=True, slots=True)
class FinalizedRetrievalResult:
    """The only records allowed to affect output, access scope, or statistics."""

    items: tuple[FinalizedRetrievalItem, ...]


@dataclass(frozen=True, slots=True)
class FinalizedKnowledgeResponse:
    """Detached, publishable knowledge output materialized inside one short session."""

    sources: tuple[Source, ...]
    context: str
    attachments: tuple[RetrievedAttachment, ...]
    trace_documents: tuple[RetrievedTraceDocument, ...]
    selected_segment_ids: tuple[str, ...]


@runtime_checkable
class RetrievalFinalizer(Protocol):
    """Resolve raw retrieval candidates into the sole publishable result set."""

    def finalize_response(
        self,
        *,
        candidates: Sequence[Document],
        tenant_id: str,
        dataset_ids: Sequence[str],
        top_k: int,
        retriever_from: str,
    ) -> FinalizedKnowledgeResponse:
        """Authorize, select, sign, and fully detach the final response values."""
        ...
