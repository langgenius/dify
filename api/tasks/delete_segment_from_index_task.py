import json
import logging
import time

import click
from celery import shared_task
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
from core.rag.index_processor.index_processor import IndexProcessorFactory
from extensions.ext_redis import redis_client
from models.dataset import Dataset, Document, SegmentAttachmentBinding
from repositories.file.upload_file_repository import UploadFileRepository
from services.file_adapters import build_upload_file_reclaimer, delete_upload_blob
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.contracts import PENDING_UPLOAD_CLEANUP_IDS_KEY, pending_upload_cleanup_ids
from services.knowledge.indexing.locks import KnowledgeIndexingLease, document_index_lock_name
from services.knowledge.summaries.adapters import SummaryIndexAdapter

logger = logging.getLogger(__name__)


def _stage_attachment_cleanup(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_id: str,
    segment_ids: list[str],
) -> tuple[str, ...]:
    """Remove bindings while retaining durable evidence for physical cleanup."""

    document = session.scalar(
        select(Document)
        .where(
            Document.id == document_id,
            Document.tenant_id == tenant_id,
            Document.dataset_id == dataset_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if document is None:
        return ()

    bindings = session.scalars(
        select(SegmentAttachmentBinding)
        .where(
            SegmentAttachmentBinding.tenant_id == tenant_id,
            SegmentAttachmentBinding.dataset_id == dataset_id,
            SegmentAttachmentBinding.document_id == document_id,
            SegmentAttachmentBinding.segment_id.in_(segment_ids),
        )
        .order_by(SegmentAttachmentBinding.id)
        .with_for_update()
    ).all()
    attachment_ids = tuple(dict.fromkeys(binding.attachment_id for binding in bindings))
    cleanup_ids = tuple(dict.fromkeys((*pending_upload_cleanup_ids(document.data_source_info_dict), *attachment_ids)))
    if cleanup_ids:
        source_info = dict(document.data_source_info_dict)
        source_info[PENDING_UPLOAD_CLEANUP_IDS_KEY] = list(cleanup_ids)
        document.data_source_info = json.dumps(source_info, ensure_ascii=False)

    binding_ids = [binding.id for binding in bindings]
    for offset in range(0, len(binding_ids), 1000):
        session.execute(
            delete(SegmentAttachmentBinding).where(
                SegmentAttachmentBinding.tenant_id == tenant_id,
                SegmentAttachmentBinding.dataset_id == dataset_id,
                SegmentAttachmentBinding.document_id == document_id,
                SegmentAttachmentBinding.id.in_(binding_ids[offset : offset + 1000]),
            )
        )
    return cleanup_ids


def _acknowledge_attachment_cleanup(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_id: str,
    processed_file_ids: tuple[str, ...],
) -> None:
    processed = frozenset(processed_file_ids)
    if not processed:
        return
    document = session.scalar(
        select(Document)
        .where(
            Document.id == document_id,
            Document.tenant_id == tenant_id,
            Document.dataset_id == dataset_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if document is None:
        return
    source_info = dict(document.data_source_info_dict)
    remaining = [file_id for file_id in pending_upload_cleanup_ids(source_info) if file_id not in processed]
    if remaining:
        source_info[PENDING_UPLOAD_CLEANUP_IDS_KEY] = remaining
    else:
        source_info.pop(PENDING_UPLOAD_CLEANUP_IDS_KEY, None)
    document.data_source_info = json.dumps(source_info, ensure_ascii=False)


@shared_task(
    queue="dataset",
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=5,
    acks_late=True,
    reject_on_worker_lost=True,
)
def delete_segment_from_index_task(
    index_node_ids: list, dataset_id: str, document_id: str, segment_ids: list, child_node_ids: list | None = None
):
    """
    Async Remove segment from index
    :param index_node_ids:
    :param dataset_id:
    :param document_id:

    Usage: delete_segment_from_index_task.delay(index_node_ids, dataset_id, document_id)
    """
    locks = RedisKnowledgeIndexingLock(redis=redis_client)
    with locks.hold(document_index_lock_name(document_id), timeout=600, blocking_timeout=5) as lease:
        _delete_segment_from_index(
            index_node_ids,
            dataset_id,
            document_id,
            segment_ids,
            child_node_ids,
            lease=lease,
        )
        lease.assert_owned()


def _delete_segment_from_index(
    index_node_ids: list,
    dataset_id: str,
    document_id: str,
    segment_ids: list,
    child_node_ids: list | None,
    *,
    lease: KnowledgeIndexingLease,
) -> None:
    logger.info(
        click.style(
            f"Start delete segment from index: dataset_id={dataset_id}, document_id={document_id}, "
            f"segment_ids={segment_ids}",
            fg="green",
        )
    )
    start_at = time.perf_counter()
    tenant_id: str | None = None
    with session_factory.create_session() as session:
        try:
            dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
            if not dataset:
                logger.warning(
                    "Dataset not found, skipping segment index cleanup: dataset_id=%s document_id=%s segment_ids=%s",
                    dataset_id,
                    document_id,
                    segment_ids,
                )
                return
            tenant_id = dataset.tenant_id

            dataset_document = session.scalar(
                select(Document)
                .where(
                    Document.id == document_id,
                    Document.tenant_id == dataset.tenant_id,
                    Document.dataset_id == dataset.id,
                )
                .limit(1)
            )
            if not dataset_document:
                return

            doc_form = dataset_document.doc_form

            # Segment rows are committed before this message is published, so
            # processor-level node-to-segment lookup cannot discover their
            # summaries. The message already carries the validated segment
            # identities; constrain them by the trusted document owner chain.
            if segment_ids:
                SummaryIndexAdapter.delete_summaries_for_segments(
                    dataset,
                    segment_ids,
                    document_id=document_id,
                    session=session,
                )

            # Proceed with index cleanup using the index_node_ids directly
            index_processor = IndexProcessorFactory(doc_form).init_index_processor()
            lease.assert_owned()
            index_processor.clean(
                dataset,
                index_node_ids,
                with_keywords=True,
                delete_child_chunks=True,
                precomputed_child_node_ids=child_node_ids,
                delete_summaries=False,
                session=session,
            )
            lease.assert_owned()
            session.commit()
            # Commit owner removal and durable candidates before taking the
            # UploadFile locks used by global reclamation. This keeps the lock
            # order acyclic and leaves retry evidence if reference checks fail.
            cleanup_ids = _stage_attachment_cleanup(
                session,
                tenant_id=dataset.tenant_id,
                dataset_id=dataset.id,
                document_id=document_id,
                segment_ids=segment_ids,
            )
            if cleanup_ids:
                session.commit()
                sessions = session_factory.get_session_maker()
                files = UploadFileRepository(session_factory=sessions)
                reclaimer = build_upload_file_reclaimer(session_factory=sessions, files=files)
                deleted_ids = reclaimer.delete_unreferenced_files(
                    tenant_id=dataset.tenant_id,
                    file_ids=cleanup_ids,
                    delete_blob=delete_upload_blob,
                    retry_on_contention=True,
                )
                lease.assert_owned()
                _acknowledge_attachment_cleanup(
                    session,
                    tenant_id=dataset.tenant_id,
                    dataset_id=dataset.id,
                    document_id=document_id,
                    processed_file_ids=deleted_ids,
                )
                session.commit()
            else:
                session.rollback()

            # Attachment vectors remain dataset-wide physical objects. Reads
            # require a current binding, and dataset cleanup owns vector GC.

            end_at = time.perf_counter()
            logger.info(
                click.style(
                    f"Segment deleted from index: tenant_id={tenant_id}, dataset_id={dataset_id}, "
                    f"document_id={document_id}, segment_ids={segment_ids}, latency={end_at - start_at}",
                    fg="green",
                )
            )
        except Exception:
            session.rollback()
            logger.exception(
                "Delete segment from index failed: tenant_id=%s dataset_id=%s document_id=%s segment_ids=%s",
                tenant_id,
                dataset_id,
                document_id,
                segment_ids,
            )
            raise
