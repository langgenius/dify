from datetime import datetime
from typing import Any

from pydantic import field_validator

from fields.base import ResponseModel
from libs.helper import to_timestamp


class HitTestingQuery(ResponseModel):
    content: str


class HitTestingDocument(ResponseModel):
    id: str
    data_source_type: str
    name: str
    doc_type: str | None
    doc_metadata: Any | None

    @field_validator("data_source_type", "doc_type", mode="before")
    @classmethod
    def _normalize_enum_fields(cls, value: Any) -> Any:
        return _normalize_enum(value)


class HitTestingSegment(ResponseModel):
    id: str
    position: int
    document_id: str
    content: str
    sign_content: str | None
    answer: str | None
    word_count: int
    tokens: int
    keywords: list[str]
    index_node_id: str | None
    index_node_hash: str | None
    hit_count: int
    enabled: bool
    disabled_at: int | None
    disabled_by: str | None
    status: str
    created_by: str
    created_at: int
    indexing_at: int | None
    completed_at: int | None
    error: str | None
    stopped_at: int | None
    document: HitTestingDocument

    @field_validator("disabled_at", "created_at", "indexing_at", "completed_at", "stopped_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_enum_fields(cls, value: Any) -> Any:
        return _normalize_enum(value)


class HitTestingChildChunk(ResponseModel):
    id: str
    content: str
    position: int
    score: float


class HitTestingFile(ResponseModel):
    id: str
    name: str
    size: int
    extension: str
    mime_type: str
    source_url: str


class HitTestingRecord(ResponseModel):
    segment: HitTestingSegment
    child_chunks: list[HitTestingChildChunk]
    score: float | None
    tsne_position: Any | None
    files: list[HitTestingFile]
    summary: str | None


class HitTestingResponse(ResponseModel):
    query: HitTestingQuery
    records: list[HitTestingRecord]


def _normalize_enum(value: Any) -> Any:
    if isinstance(value, str) or value is None:
        return value
    return getattr(value, "value", value)
