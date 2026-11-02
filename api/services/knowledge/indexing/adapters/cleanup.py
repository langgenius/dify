"""Delete document indexes between bounded database transactions."""

from collections.abc import Callable, Generator, Mapping, Sequence
from contextlib import ExitStack, contextmanager

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
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.locks import KnowledgeIndexingLease, document_index_lock_name

_DOCUMENT_CLEANUP_BATCH_SIZE = 16


def document_cleanup_batches(document_ids: Sequence[str]) -> Generator[tuple[str, ...]]:
    unique_ids = sorted(set(document_ids))
    for offset in range(0, len(unique_ids), _DOCUMENT_CLEANUP_BATCH_SIZE):
        yield tuple(unique_ids[offset : offset + _DOCUMENT_CLEANUP_BATCH_SIZE])


@contextmanager
def hold_document_cleanup_locks(document_ids: Sequence[str]) -> Generator[dict[str, KnowledgeIndexingLease]]:
    if len(document_ids) > _DOCUMENT_CLEANUP_BATCH_SIZE:
        raise ValueError("Document cleanup lease batch exceeds the bounded size")
    locks = RedisKnowledgeIndexingLock(redis=redis_client)
    with ExitStack() as stack:
        leases = {
            document_id: stack.enter_context(
                locks.hold(document_index_lock_name(document_id), timeout=600, blocking_timeout=5)
            )
            for document_id in sorted(set(document_ids))
        }
        yield leases
        for lease in leases.values():
            lease.assert_owned()


def delete_index_entries(
    dataset: Dataset,
    *,
    vector_node_ids: Sequence[str],
    vector_type: str | None,
    keyword_node_ids: Sequence[str],
    new_session: Callable[[], Session],
) -> None:
    """Delete index entries by node id; the single owner of how each index type is removed.

    High-quality datasets delete ``vector_node_ids`` from the vector store; other datasets
    delete ``keyword_node_ids`` from the keyword table under the dataset keyword lock.
    """
    if dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
        if vector_node_ids:
            Vector(dataset, session=None, vector_type=vector_type).delete_by_ids(list(vector_node_ids))
        return
    if not keyword_node_ids:
        return

    # The keyword adapter owns its lock and storage I/O; callbacks only do SQL.
    def read() -> tuple[str, str | None]:
        with new_session() as session:
            row = get_dataset_keyword_table(dataset, session=session)
            return (row.data_source_type, row.keyword_table) if row else (dify_config.KEYWORD_DATA_SOURCE_TYPE, None)

    def write(storage_type: str, data: str, keywords: Mapping[str, Sequence[str]]) -> None:
        with new_session() as session, session.begin():
            persist_keyword_table(
                session,
                tenant_id=dataset.tenant_id,
                dataset_id=dataset.id,
                storage_type=storage_type,
                data=data,
                keywords=keywords,
            )

    Jieba(dataset).update_texts(
        [],
        read=read,
        write=write,
        lock=redis_client.lock(f"keyword_indexing_lock_{dataset.id}", timeout=600),
        deleted_ids=keyword_node_ids,
    )


def clean_document_indexes(
    *,
    dataset_id: str,
    document_ids: Sequence[str],
    doc_form: str | None,
    new_session: Callable[[], Session],
    owned_leases: Mapping[str, KnowledgeIndexingLease] | None = None,
) -> str | None:
    """Clean indexes even when the owning document rows have already been deleted.

    Snapshot the dataset-owned rows, close the read session, remove external
    indexes, then delete the selected summary rows. Child rows retain their
    content until relational cleanup can reclaim their files in the same
    transaction. A failed vector deletion leaves every row available for retry.
    Empty document selections never mean deleting the entire dataset index.
    """
    if not document_ids:
        return None
    if owned_leases is None:
        tenant_id = None
        for batch in document_cleanup_batches(document_ids):
            with hold_document_cleanup_locks(batch) as leases:
                result = clean_document_indexes(
                    dataset_id=dataset_id,
                    document_ids=batch,
                    doc_form=doc_form,
                    new_session=new_session,
                    owned_leases=leases,
                )
                tenant_id = result or tenant_id
        return tenant_id
    for document_id in document_ids:
        owned_leases[document_id].assert_owned()
    return _clean_document_indexes(
        dataset_id=dataset_id,
        document_ids=document_ids,
        doc_form=doc_form,
        new_session=new_session,
        leases=tuple(owned_leases.values()),
    )


def _clean_document_indexes(
    *,
    dataset_id: str,
    document_ids: Sequence[str],
    doc_form: str | None,
    new_session: Callable[[], Session],
    leases: Sequence[KnowledgeIndexingLease],
) -> str | None:
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

    for lease in leases:
        lease.assert_owned()
    delete_index_entries(
        dataset,
        vector_node_ids=node_ids,
        vector_type=vector_type,
        keyword_node_ids=body_node_ids,
        new_session=new_session,
    )

    for lease in leases:
        lease.assert_owned()
    with new_session() as session, session.begin():
        if summary_ids:
            session.execute(
                delete(DocumentSegmentSummary).where(
                    DocumentSegmentSummary.dataset_id == dataset_id,
                    DocumentSegmentSummary.document_id.in_(document_ids),
                    DocumentSegmentSummary.id.in_(summary_ids),
                )
            )
    return tenant_id
