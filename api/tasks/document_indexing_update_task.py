import logging
import time

import click
from celery import shared_task
from sqlalchemy import select

from core.db.session_factory import session_factory
from core.rag.index_processor.index_processor import IndexProcessorFactory
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models.dataset import Document, DocumentSegment
from models.enums import IndexingStatus
from models.model import UploadFile
from repositories.knowledge.dataset_repository import lock_dataset_for_child_write
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.segment_repository import (
    delete_document_segments_for_replacement,
    enqueue_upload_file_cleanup,
)
from repositories.knowledge.upload_file_repository import find_orphan_upload_files
from services.knowledge.indexing.adapters.execution import build_document_indexing_service
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.cleanup import UploadFileCleanup
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.indexing.errors import DocumentIndexingGenerationChangedError, DocumentIsPausedError
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLeaseLostError,
    KnowledgeIndexingLockBusyError,
    dataset_index_lock_name,
    document_index_lock_name,
)
from services.knowledge.resource_scope import DatasetRef, DocumentRef
from services.knowledge.task_outbox.contracts import (
    KnowledgeTaskDeliveryHandledError,
    KnowledgeTaskExecutionLeaseLostError,
    KnowledgeTaskRequeuedError,
)
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit
from tasks.document_execution_recovery import repair_recovered_document_execution
from tasks.document_legacy_conversion import convert_legacy_document_indexing_delivery
from tasks.knowledge_task_outbox_task import defer_knowledge_task_before_execution, knowledge_task_execution

logger = logging.getLogger(__name__)
_LEASE_TIMEOUT_SECONDS = 600
_LOCK_RETRY_DELAY_SECONDS = 10


@shared_task(
    queue="dataset",
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(Exception,),
    dont_autoretry_for=(KnowledgeTaskDeliveryHandledError,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 10},
)
def document_indexing_update_task(
    dataset_id: str,
    document_id: str,
    expected_generation: str | None = None,
    attachment_ids: list[str] | None = None,
    outbox_id: str | None = None,
) -> None:
    """Rebuild a document and durably retry incomplete destructive cleanup."""
    if expected_generation is None and outbox_id is None:
        convert_legacy_document_indexing_delivery(dataset_id, [document_id])
        return
    document_ref, current_generation = _snapshot_update_document(
        dataset_id,
        document_id,
        expected_generation=expected_generation,
        generation_was_supplied=outbox_id is not None or expected_generation is not None,
    )
    if document_ref is None:
        if outbox_id is not None:
            with knowledge_task_execution(outbox_id):
                pass
        return
    locks = RedisKnowledgeIndexingLock(redis=redis_client)
    try:
        with locks.hold(
            dataset_index_lock_name(dataset_id), timeout=_LEASE_TIMEOUT_SECONDS, blocking_timeout=30
        ) as dataset_lease:
            with locks.hold(document_index_lock_name(document_id), timeout=_LEASE_TIMEOUT_SECONDS) as document_lease:
                with knowledge_task_execution(outbox_id) as execution:
                    if execution is None:
                        return

                    documents = SQLAlchemyDocumentRepository(
                        session_factory=session_factory.get_session_maker(),
                        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
                    )
                    if repair_recovered_document_execution(
                        execution,
                        documents=documents,
                        ref=document_ref.dataset,
                        document_ids=[document_id],
                    ):
                        return

                    def assert_owned() -> None:
                        execution.assert_owned()
                        dataset_lease.assert_owned()
                        document_lease.assert_owned()
                        documents.assert_indexing_generation(document_ref, current_generation)

                    generation_fence = DocumentIndexingExecution(
                        current_generation,
                        assert_owned,
                        task_intent_id=execution.intent_id,
                        task_execution_id=execution.execution_id,
                    )
                    try:
                        assert_owned()
                        _run_document_indexing_update(
                            document_ref,
                            current_generation,
                            attachment_ids or [],
                            outbox_id,
                            generation_fence,
                            documents,
                        )
                    except DocumentIndexingGenerationChangedError:
                        documents.enqueue_current_indexing_repairs(document_ref.dataset, [document_id])
                    except (KnowledgeIndexingLeaseLostError, KnowledgeTaskExecutionLeaseLostError):
                        documents.enqueue_current_indexing_repairs(document_ref.dataset, [document_id])
                        raise
    except KnowledgeIndexingLockBusyError as error:
        if outbox_id is None:
            raise
        if not defer_knowledge_task_before_execution(outbox_id, error=str(error), delay=_LOCK_RETRY_DELAY_SECONDS):
            logger.info("Skipping duplicate or terminal document update delivery: %s", outbox_id)
            return
        raise KnowledgeTaskRequeuedError(
            f"document update {outbox_id} was deferred while its indexing lock is held"
        ) from error


def _snapshot_update_document(
    dataset_id: str,
    document_id: str,
    *,
    expected_generation: str | None,
    generation_was_supplied: bool,
) -> tuple[DocumentRef | None, str | None]:
    with session_factory.create_session() as session:
        conditions = [Document.id == document_id, Document.dataset_id == dataset_id]
        if generation_was_supplied:
            conditions.append(Document.indexing_generation == expected_generation)
        row = session.execute(
            select(Document.tenant_id, Document.indexing_generation).where(*conditions).limit(1)
        ).one_or_none()
        if row is None:
            return None, None
        return DatasetRef(row.tenant_id, dataset_id).document(document_id), row.indexing_generation


def _run_document_indexing_update(
    document_ref: DocumentRef,
    expected_generation: str | None,
    attachment_ids: list[str],
    outbox_id: str | None,
    execution: DocumentIndexingExecution,
    documents: SQLAlchemyDocumentRepository,
) -> None:
    """
    Async update document
    :param dataset_id:
    :param document_id:

    Usage: document_indexing_update_task.delay(dataset_id, document_id)
    """
    dataset_id = document_ref.dataset.dataset_id
    document_id = document_ref.document_id
    logger.info(click.style(f"Start update document: {document_id}", fg="green"))
    start_at = time.perf_counter()

    try:
        with session_factory.create_session() as session:
            execution.assert_owned()
            dataset = lock_dataset_for_child_write(session, document_ref.dataset)
            if dataset is None:
                raise DocumentIndexingGenerationChangedError(document_id)
            document_conditions = [
                Document.id == document_id,
                Document.dataset_id == dataset_id,
                Document.tenant_id == document_ref.dataset.tenant_id,
                Document.indexing_generation == expected_generation,
            ]
            document = session.scalar(
                select(Document).where(*document_conditions).with_for_update().execution_options(populate_existing=True)
            )
            if document is None:
                raise DocumentIndexingGenerationChangedError(document_id)

            document.indexing_status = IndexingStatus.PARSING
            document.processing_started_at = naive_utc_now()

            index_type = document.doc_form
            segments = session.scalars(
                select(DocumentSegment).where(
                    DocumentSegment.tenant_id == document_ref.dataset.tenant_id,
                    DocumentSegment.dataset_id == dataset_id,
                    DocumentSegment.document_id == document_id,
                )
            ).all()
            index_node_ids = [segment.index_node_id for segment in segments if segment.index_node_id]
            # Persist the parsing status before vector cleanup and extraction.
            execution.assert_owned()
            documents.commit_indexing_phase(session, document_ref, execution=execution)

            clean_success = False
            index_processor = None
            try:
                execution.assert_owned()
                index_processor = IndexProcessorFactory(index_type).init_index_processor()
                if index_node_ids:
                    index_processor.clean(
                        dataset,
                        index_node_ids,
                        with_keywords=True,
                        delete_child_chunks=False,
                        session=session,
                    )
                    execution.assert_owned()
                    end_at = time.perf_counter()
                    logger.info(
                        click.style(
                            f"Cleaned document when document update data source or process rule: {document_id} "
                            f"latency: {end_at - start_at}",
                            fg="green",
                        )
                    )
                clean_success = True
            except (
                DocumentIndexingGenerationChangedError,
                KnowledgeIndexingLeaseLostError,
                KnowledgeTaskExecutionLeaseLostError,
            ):
                session.rollback()
                raise
            except Exception:
                logger.exception("Failed to clean document index during update, document_id: %s", document_id)
                session.rollback()
                execution.assert_owned()
                if outbox_id is not None:
                    raise
                return

            if clean_success and index_processor is not None:
                cleanup_file_ids: tuple[str, ...] = ()
                if lock_dataset_for_child_write(session, document_ref.dataset) is None:
                    raise DocumentIndexingGenerationChangedError(document_id)
                execution.assert_owned()
                document = session.scalar(
                    select(Document)
                    .where(
                        Document.tenant_id == dataset.tenant_id,
                        Document.dataset_id == dataset.id,
                        Document.id == document_id,
                        Document.indexing_generation == expected_generation,
                    )
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
                if document is None:
                    raise DocumentIndexingGenerationChangedError(document_id)
                cleanup_file_ids = delete_document_segments_for_replacement(
                    session,
                    document_ref,
                    owner_locks_held=True,
                )
                attachment_ids = list(dict.fromkeys([*attachment_ids, *cleanup_file_ids]))
                if enqueue_upload_file_cleanup(session, document_ref, cleanup_file_ids) is not None:
                    wake_knowledge_task_dispatcher_after_commit(session)
                execution.assert_owned()
                documents.commit_indexing_phase(session, document_ref, execution=execution)

                current_files = session.scalars(
                    select(UploadFile).where(
                        UploadFile.tenant_id == dataset.tenant_id,
                        UploadFile.id.in_(attachment_ids),
                    )
                ).all()
                current_files_by_id = {file.id: file for file in current_files}
                orphan_files = find_orphan_upload_files(
                    session,
                    tenant_id=dataset.tenant_id,
                    files=tuple(
                        UploadFileCleanup(
                            id=file_id,
                            key=current_files_by_id[file_id].key if file_id in current_files_by_id else None,
                        )
                        for file_id in attachment_ids
                    ),
                )
                if orphan_files and dataset.is_multimodal:
                    execution.assert_owned()
                    index_processor.clean(
                        session=session,
                        dataset=dataset,
                        node_ids=[file.id for file in orphan_files],
                        with_keywords=False,
                    )
                    execution.assert_owned()
                    documents.commit_indexing_phase(session, document_ref, execution=execution)

            indexing_service = build_document_indexing_service(session_factory=session_factory.get_session_maker())
            document_refs = [DatasetRef(document.tenant_id, document.dataset_id).document(document.id)]
            documents.commit_indexing_phase(session, document_ref, execution=execution)
            indexing_service.run(document_refs, executions={document.id: execution})
            execution.assert_owned()

            end_at = time.perf_counter()
            logger.info(click.style(f"update document: {document.id} latency: {end_at - start_at}", fg="green"))
    except DocumentIsPausedError as ex:
        logger.info(click.style(str(ex), fg="yellow"))
        if outbox_id is not None:
            raise
        return
    except (
        DocumentIndexingGenerationChangedError,
        KnowledgeIndexingLeaseLostError,
        KnowledgeTaskExecutionLeaseLostError,
    ):
        raise
    except Exception:
        logger.exception("document_indexing_update_task failed, document_id: %s", document_id)
        if outbox_id is not None:
            raise
        return

    documents.enqueue_summary_indexes(
        document_ref.dataset,
        {document_id: expected_generation},
        assert_owned=execution.assert_owned,
    )
