from typing import Any

from pydantic import BaseModel


class RetrievalSourceMetadata(BaseModel):
    position: int = None
    dataset_id: str = None
    dataset_name: str = None
    document_id: str = None
    document_name: str = None
    data_source_type: str = None
    segment_id: str = None
    retriever_from: str = None
    score: float = None
    hit_count: int = None
    word_count: int = None
    segment_position: int = None
    index_node_hash: str = None
    content: str = None
    page: int = None
    doc_metadata: dict[str, Any] = None
    title: str = None
    files: list[dict[str, Any]] = None
    summary: str = None
