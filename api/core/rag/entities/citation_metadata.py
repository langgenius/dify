from typing import Any, Optional

from pydantic import BaseModel


class RetrievalSourceMetadata(BaseModel):
    position: Optional[int] = None
    dataset_id: Optional[str] = None
    dataset_name: Optional[str] = None
    document_id: Optional[str] = None
    document_name: Optional[str] = None
    data_source_type: Optional[str] = None
    segment_id: Optional[str] = None
    retriever_from: Optional[str] = None
    score: Optional[float] = None
    hit_count: Optional[int] = None
    word_count: Optional[int] = None
    segment_position: Optional[int] = None
    index_node_hash: Optional[str] = None
    content: Optional[str] = None
    page: Optional[int] = None
    doc_metadata: Optional[dict[str, Any]] = None
    title: Optional[str] = None
