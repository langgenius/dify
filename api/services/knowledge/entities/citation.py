from dify_agent.protocol.knowledge_fs import KnowledgeFsCitation
from pydantic import BaseModel, JsonValue

from services.knowledge.entities.retrieval import AttachmentInfoDict, Source


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
    doc_metadata: dict[str, JsonValue] | None = None
    title: str | None = None
    files: list[AttachmentInfoDict] | None = None
    summary: str | None = None
    knowledge_fs_citation: KnowledgeFsCitation | None = None
    document_asset_id: str | None = None
    document_revision: int | None = None
    document_version: int | None = None


def to_retrieval_source_metadata(source: Source) -> RetrievalSourceMetadata:
    """Present the identity and content captured on the final retrieved source."""
    metadata = source.metadata
    is_development_retrieval = metadata.retriever_from == "dev"
    return RetrievalSourceMetadata(
        position=metadata.position,
        dataset_id=metadata.dataset_id,
        dataset_name=metadata.dataset_name,
        document_id=metadata.document_id,
        document_name=metadata.document_name,
        data_source_type=metadata.data_source_type,
        segment_id=metadata.segment_id,
        retriever_from=metadata.retriever_from,
        score=metadata.score,
        hit_count=metadata.segment_hit_count if is_development_retrieval else None,
        word_count=metadata.segment_word_count if is_development_retrieval else None,
        segment_position=metadata.segment_position if is_development_retrieval else None,
        index_node_hash=metadata.segment_index_node_hash if is_development_retrieval else None,
        content=source.content,
        doc_metadata=metadata.doc_metadata,
        title=source.title,
        files=source.files,
        summary=source.summary,
    )
