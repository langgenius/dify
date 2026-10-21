"""Framework-neutral contracts shared by knowledge retrieval consumers."""

from dataclasses import dataclass
from typing import Any, Protocol, TypedDict

from machinery.context import RequestContext
from services.knowledge.entities.resource_scope import DatasetRef


class QueryDict(TypedDict):
    content: str


class RetrieveResponseDict(TypedDict):
    query: QueryDict
    records: list[dict[str, Any]]


@dataclass(frozen=True, slots=True)
class HitTestingResult:
    response: RetrieveResponseDict
    record_query: bool


@dataclass(frozen=True, slots=True)
class HitTestingRequest:
    query: str
    retrieval_model: dict[str, Any] | None
    attachment_ids: list[str] | None


class HitTestingQueryRecorder(Protocol):
    def record_hit_testing_query(self, context: RequestContext, ref: DatasetRef, content: str) -> None: ...


def validate_hit_testing_input(query: str, attachment_ids: list[str] | None) -> None:
    if not attachment_ids and not query:
        raise ValueError("Query or attachment_ids is required")
    if len(query) > 250:
        raise ValueError("Query cannot exceed 250 characters")


def external_hit_testing_response(query: str, documents: list[dict[str, Any]]) -> RetrieveResponseDict:
    return {
        "query": {"content": query},
        "records": [
            {key: document.get(key) for key in ("content", "title", "score", "metadata")} for document in documents
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
    summaries: dict[str, str]
