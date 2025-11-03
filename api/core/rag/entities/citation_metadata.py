from typing import Any

from pydantic import BaseModel


class RetrievalSourceMetadata(BaseModel):
    position: int | None = None
    dataset_id: str | None = None
    dataset_name: str | None = None
    document_id: str | None = None
    document_name: str | None = None
    data_source_type: str | None = None
    segment_id: str | None = None
    retriever_from: str | None = None
    score: float | None = None
    hit_count: int | None = None
    word_count: int | None = None
    segment_position: int | None = None
    index_node_hash: str | None = None
    content: str | None = None
    page: int | None = None
    doc_metadata: dict[str, Any] | None = None
    title: str | None = None
