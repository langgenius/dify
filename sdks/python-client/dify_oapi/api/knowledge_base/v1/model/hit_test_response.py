from __future__ import annotations

from dify_oapi.core.model.base_response import BaseResponse
from pydantic import BaseModel


class HitTestResponse(BaseResponse):
    query: Query | None = None
    records: list[Record] | None = None


class Query(BaseModel):
    content: str | None = None


class Record(BaseModel):
    segment: Segment | None = None
    score: float | None = None
    tsne_position: float | None = None


class Segment(BaseModel):
    id: str | None = None
    position: int | None = None
    document_id: str | None = None
    content: str | None = None
    answer: str | None = None
    word_count: int | None = None
    tokens: int | None = None
    keywords: list[str] | None = None
    index_node_id: str | None = None
    index_node_hash: str | None = None
    hit_count: int | None = None
    enabled: bool | None = None
    disabled_at: int | None = None
    disabled_by: str | None = None
    status: str | None = None
    created_by: str | None = None
    created_at: int | None = None
    indexing_at: int | None = None
    completed_at: int | None = None
    error: str | None = None
    stopped_at: int | None = None
    document: Document


class Document(BaseModel):
    id: str | None = None
    data_source_type: str | None = None
    name: str | None = None
    doc_type: str | None = None
