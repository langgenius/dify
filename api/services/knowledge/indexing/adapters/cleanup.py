"""Delete document indexes between bounded database transactions."""

from collections.abc import Callable, Mapping, Sequence
from contextlib import ExitStack

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from configs import dify_config
from core.rag.datasource.keyword.jieba.jieba import Jieba
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from extensions.ext_redis import redis_client
from models.dataset import ChildChunk, Dataset, DocumentSegment, DocumentSegmentSummary, SegmentAttachmentBinding
from models.model import UploadFile
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


# Bounds both the number of attachment locks held at once and the size of each IN clause.
ATTACHMENT_RELEASE_BATCH_SIZE = 100


def release_document_attachments(
    *, dataset_id: str, document_ids: Sequence[str], new_session: Callable[[], Session]
) -> list[str]:
    """Release the segment attachments bound to documents that are being deleted.

    Attachments are discovered through their bindings, not through segments, so a retry
    still finds them after the segment rows are gone.

    One ``UploadFile`` can be bound to segments of several documents and datasets, so two
    scopes are decided separately. Its vector lives in this dataset's collection and is
    removed once no other binding in this dataset remains; the file row is shared and is
    removed only once no other binding anywhere remains.

    Each attachment is locked while its remaining references are counted and released, so
    concurrent deletions of documents sharing it cannot each see the other's binding and
    both keep it. Vectors go before bindings: if the vector deletion fails, the bindings
    are still there for the next attempt.

    Returns the storage keys of the attachment files whose rows were deleted; the caller
    removes the blobs once its own relational cleanup is done.
    """
    if not document_ids:
        return []
    with new_session() as session:
        dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id))
        if dataset is None:
            return []
        tenant_id = dataset.tenant_id
        attachment_ids = sorted(
            set(
                session.scalars(
                    select(SegmentAttachmentBinding.attachment_id).where(
                        SegmentAttachmentBinding.tenant_id == tenant_id,
                        SegmentAttachmentBinding.dataset_id == dataset_id,
                        SegmentAttachmentBinding.document_id.in_(document_ids),
                    )
                ).all()
            )
        )
        high_quality = dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY
        vector_type = Vector.resolve_vector_type(dataset, session=session) if high_quality and attachment_ids else None
        session.expunge(dataset)

    storage_keys: list[str] = []
    for start in range(0, len(attachment_ids), ATTACHMENT_RELEASE_BATCH_SIZE):
        batch = attachment_ids[start : start + ATTACHMENT_RELEASE_BATCH_SIZE]
        with ExitStack() as locks:
            # Ids are sorted, so every caller acquires in the same order and cannot deadlock.
            for attachment_id in batch:
                locks.enter_context(redis_client.lock(f"segment_attachment_release_lock_{attachment_id}", timeout=600))

            # Counted under the lock: a concurrent release of another document either already
            # committed its binding deletion, which this count sees, or has not started yet.
            with new_session() as session:
                remaining_bindings = session.execute(
                    select(SegmentAttachmentBinding.attachment_id, SegmentAttachmentBinding.dataset_id).where(
                        SegmentAttachmentBinding.attachment_id.in_(batch),
                        SegmentAttachmentBinding.document_id.not_in(document_ids),
                    )
                ).all()
            bound_in_dataset = {
                attachment_id for attachment_id, bound_dataset in remaining_bindings if bound_dataset == dataset_id
            }
            bound_anywhere = {attachment_id for attachment_id, _ in remaining_bindings}
            vector_orphan_ids = [attachment_id for attachment_id in batch if attachment_id not in bound_in_dataset]
            file_orphan_ids = [attachment_id for attachment_id in batch if attachment_id not in bound_anywhere]

            # Attachment vectors are written under doc_id == UploadFile.id, which no segment,
            # child chunk or summary row points at.
            if high_quality and vector_orphan_ids:
                Vector(dataset, session=None, vector_type=vector_type).delete_by_ids(vector_orphan_ids)

            with new_session() as session, session.begin():
                if file_orphan_ids:
                    storage_keys.extend(
                        session.scalars(select(UploadFile.key).where(UploadFile.id.in_(file_orphan_ids))).all()
                    )
                # Bindings go before the rows they point at.
                session.execute(
                    delete(SegmentAttachmentBinding).where(
                        SegmentAttachmentBinding.tenant_id == tenant_id,
                        SegmentAttachmentBinding.dataset_id == dataset_id,
                        SegmentAttachmentBinding.document_id.in_(document_ids),
                        SegmentAttachmentBinding.attachment_id.in_(batch),
                    )
                )
                if file_orphan_ids:
                    session.execute(delete(UploadFile).where(UploadFile.id.in_(file_orphan_ids)))
    return storage_keys
