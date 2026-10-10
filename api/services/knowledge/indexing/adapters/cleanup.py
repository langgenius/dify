"""Delete document indexes between bounded database transactions."""

from collections.abc import Callable, Mapping, Sequence

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from configs import dify_config
from core.rag.datasource.keyword.jieba.jieba import Jieba
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from extensions.ext_redis import redis_client
from models.dataset import ChildChunk, Dataset, DocumentSegment, DocumentSegmentSummary
from repositories.knowledge.dataset_read_repository import get_dataset_keyword_table
from repositories.knowledge.keyword_table_repository import persist_keyword_table


def clean_document_indexes(
    *, dataset_id: str, document_ids: Sequence[str], doc_form: str | None, new_session: Callable[[], Session]
) -> str | None:
    """Clean indexes even when the owning document rows have already been deleted.

    Snapshot the dataset-owned rows, close the read session, remove external
    indexes, then delete the selected summary and child rows in one transaction.
    A failed vector deletion leaves those rows available for a retry.
    Empty document selections never mean deleting the entire dataset index.
    """
    if not document_ids:
        return None
    with new_session() as session:
        dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id))
        if dataset is None:
            return None
        tenant_id = dataset.tenant_id
        segments = session.scalars(
            select(DocumentSegment).where(
                DocumentSegment.tenant_id == tenant_id,
                DocumentSegment.dataset_id == dataset_id,
                DocumentSegment.document_id.in_(document_ids),
            )
        ).all()
        summaries = session.scalars(
            select(DocumentSegmentSummary).where(
                DocumentSegmentSummary.dataset_id == dataset_id,
                DocumentSegmentSummary.document_id.in_(document_ids),
            )
        ).all()
        children = session.scalars(
            select(ChildChunk).where(
                ChildChunk.tenant_id == tenant_id,
                ChildChunk.dataset_id == dataset_id,
                ChildChunk.document_id.in_(document_ids),
            )
        ).all()
        summary_ids = [summary.id for summary in summaries]
        child_ids = [child.id for child in children]
        summary_node_ids = [summary.summary_index_node_id for summary in summaries if summary.summary_index_node_id]
        body_node_ids = (
            [child.index_node_id for child in children if child.index_node_id]
            if doc_form == IndexStructureType.PARENT_CHILD_INDEX
            else [segment.index_node_id for segment in segments if segment.index_node_id]
        )
        high_quality = dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY
        node_ids = list(dict.fromkeys([*summary_node_ids, *body_node_ids]))
        vector_type = Vector.resolve_vector_type(dataset, session=session) if high_quality and node_ids else None
        session.expunge(dataset)

    if not node_ids and not summary_ids and not child_ids:
        return None

    if high_quality:
        if node_ids:
            Vector(dataset, session=None, vector_type=vector_type).delete_by_ids(node_ids)
    elif body_node_ids:
        # The keyword adapter owns its lock and storage I/O; callbacks only do SQL.
        def read() -> tuple[str, str | None]:
            with new_session() as session:
                row = get_dataset_keyword_table(dataset, session=session)
                return (
                    (row.data_source_type, row.keyword_table) if row else (dify_config.KEYWORD_DATA_SOURCE_TYPE, None)
                )

        def write(storage_type: str, data: str, keywords: Mapping[str, Sequence[str]]) -> None:
            with new_session() as session, session.begin():
                persist_keyword_table(
                    session,
                    tenant_id=tenant_id,
                    dataset_id=dataset_id,
                    storage_type=storage_type,
                    data=data,
                    keywords=keywords,
                )

        Jieba(dataset).update_texts(
            [],
            read=read,
            write=write,
            lock=redis_client.lock(f"keyword_indexing_lock_{dataset_id}", timeout=600),
            deleted_ids=body_node_ids,
        )

    with new_session() as session, session.begin():
        if summary_ids:
            session.execute(
                delete(DocumentSegmentSummary).where(
                    DocumentSegmentSummary.dataset_id == dataset_id,
                    DocumentSegmentSummary.document_id.in_(document_ids),
                    DocumentSegmentSummary.id.in_(summary_ids),
                )
            )
        if child_ids:
            session.execute(
                delete(ChildChunk).where(
                    ChildChunk.tenant_id == tenant_id,
                    ChildChunk.dataset_id == dataset_id,
                    ChildChunk.document_id.in_(document_ids),
                    ChildChunk.id.in_(child_ids),
                )
            )
    return tenant_id
