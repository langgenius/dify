"""Framework-neutral values exchanged by the knowledge hit-testing use case."""

from dataclasses import dataclass
from typing import Any, Protocol, TypedDict

from services.knowledge.entities.external import ExternalRetrievalCandidate, ExternalRetrievalConfig
from services.knowledge.entities.resource_scope import DatasetRef


class HitTestingQuery(TypedDict):
    content: str


class ExternalHitTestingRecord(TypedDict):
    content: str | None
    title: str | None
    score: float | None
    metadata: dict[str, Any] | None


class HitTestingResponse(TypedDict):
    query: HitTestingQuery
    records: list[dict[str, Any] | ExternalHitTestingRecord]


@dataclass(frozen=True, slots=True)
class HitTestingResult:
    response: HitTestingResponse
    record_query: bool


@dataclass(frozen=True, slots=True)
class HitTestingDatasetRecord:
    provider: str
    retrieval_model: dict[str, object] | None


@dataclass(frozen=True, slots=True)
class HitTestingRequest:
    query: str
    retrieval_model: dict[str, Any] | None
    external_retrieval_model: ExternalRetrievalConfig | None
    attachment_ids: list[str] | None


class HitTestingQueryRecorder(Protocol):
    def record_hit_testing_query(self, actor_id: str, ref: DatasetRef, content: str) -> None: ...


def validate_hit_testing_input(query: str, attachment_ids: list[str] | None) -> None:
    if not attachment_ids and not query:
        raise ValueError("Query or attachment_ids is required")
    if len(query) > 250:
        raise ValueError("Query cannot exceed 250 characters")


def external_hit_testing_response(query: str, documents: list[ExternalRetrievalCandidate]) -> HitTestingResponse:
    return {
        "query": {"content": query},
        "records": [
            {
                "content": document.content,
                "title": document.title,
                "score": document.score,
                "metadata": dict(document.metadata),
            }
            for document in documents
        ],
    }


@dataclass(frozen=True, slots=True)
class RetrievalDocumentRecord:
    id: str
    doc_form: str
    values: dict[str, object]


@dataclass(frozen=True, slots=True)
class RetrievalSegmentRecord:
    id: str
    document_id: str
    index_node_id: str | None
    values: dict[str, object]


@dataclass(frozen=True, slots=True)
class RetrievalChildRecord:
    id: str
    segment_id: str
    document_id: str
    index_node_id: str | None
    content: str
    position: int


@dataclass(frozen=True, slots=True)
class RetrievalAttachmentRecord:
    segment_id: str
    document_id: str
    id: str
    name: str
    extension: str
    mime_type: str | None
    size: int


@dataclass(frozen=True, slots=True)
class RetrievalSnapshot:
    segments: tuple[RetrievalSegmentRecord, ...]
    children: tuple[RetrievalChildRecord, ...]
    attachments: tuple[RetrievalAttachmentRecord, ...]
    summaries: dict[tuple[str, str, str], str]


def validate_hit_testing_request(request: HitTestingRequest) -> None:
    if not request.query and not request.attachment_ids:
        raise ValueError("Query or attachment_ids is required")
    if len(request.query) > 250:
        raise ValueError("Query cannot exceed 250 characters")
