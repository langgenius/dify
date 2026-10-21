import logging
import time
from collections.abc import Callable, Generator
from contextlib import contextmanager

import click
from celery import shared_task
from sqlalchemy import select

from configs import dify_config
from core.db.session_factory import session_factory
from core.rag.index_processor.index_processor import IndexProcessorFactory
from enums import DeploymentEdition
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import IndexingStatus
from repositories.knowledge.dataset_repository import lock_dataset_for_child_write
from repositories.knowledge.document_repository import (
    SQLAlchemyDocumentRepository,
    require_owned_indexing_document,
)
from repositories.knowledge.segment_repository import (
    delete_document_segments_for_replacement,
    enqueue_upload_file_cleanup,
)
from services.feature_service import FeatureService
from services.knowledge.documents.adapters import RedisDocumentLifecycleCache
from services.knowledge.indexing.adapters.execution import build_document_indexing_service
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.indexing.errors import DocumentIndexingGenerationChangedError
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    KnowledgeIndexingLeaseLostError,
    KnowledgeIndexingLockBusyError,
    dataset_index_lock_name,
    document_index_lock_name,
)
from services.knowledge.resource_scope import DatasetRef, DocumentRef
from services.knowledge.task_outbox.contracts import (
    KnowledgeTaskDeliveryHandledError,
    KnowledgeTaskExecutionLeaseLostError,
    KnowledgeTaskPermanentError,
    KnowledgeTaskRequeuedError,
    KnowledgeTaskRetriesExhaustedError,
)
from services.knowledge.task_outbox.execution import KnowledgeTaskExecutionLease
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit
from tasks.knowledge_task_outbox_task import defer_knowledge_task_before_execution, knowledge_task_execution

logger = logging.getLogger(__name__)
_LEASE_TIMEOUT_SECONDS = 600
_LOCK_RETRY_DELAY_SECONDS = 10


def _indexing_lock() -> RedisKnowledgeIndexingLock:
    return RedisKnowledgeIndexingLock(redis=redis_client)


@contextmanager
def _repair_stale_indexing(
    *,
    document_id: str,
    side_effect_started: Callable[[], bool],
    enqueue_repair: Callable[[], None],
) -> Generator[None]:
    """Resolve stale ownership before the durable execution context observes it."""
    try:
        yield
    except DocumentIndexingGenerationChangedError:
        logger.info("Website sync generation changed for document %s", document_id)
        if side_effect_started():
            enqueue_repair()
    except (KnowledgeIndexingLeaseLostError, KnowledgeTaskExecutionLeaseLostError):
        enqueue_repair()
        raise


@shared_task(
    queue="dataset",
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(Exception,),
    dont_autoretry_for=(KnowledgeTaskDeliveryHandledError,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 10},
)
def sync_website_document_indexing_task(
    dataset_id: str,
    document_id: str,
    expected_generation: str | None = None,
    outbox_id: str | None = None,
) -> None:
    release_marker = False
    try:
        release_marker = _run_sync_website_document_indexing(
            dataset_id,
            document_id,
            expected_generation,
            outbox_id,
        )
    except (KnowledgeTaskPermanentError, KnowledgeTaskRetriesExhaustedError):
        release_marker = True
        raise
    finally:
        if release_marker and expected_generation is not None:
            RedisDocumentLifecycleCache(redis=redis_client).clear_syncing(
                document_id,
                token=expected_generation,
            )


def _run_sync_website_document_indexing(
    dataset_id: str,
    document_id: str,
    expected_generation: str | None,
    outbox_id: str | None,
) -> bool:
    """
    Async process document
    :param dataset_id:
    :param document_id:

    Usage: sync_website_document_indexing_task.delay(dataset_id, document_id)
    """
    start_at = time.perf_counter()
    document_ref: DocumentRef | None = None
    indexing_execution: DocumentIndexingExecution | None = None
    external_started = False
    repair_enqueued = False
    documents = SQLAlchemyDocumentRepository(
        session_factory=session_factory.get_session_maker(),
        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
    )
    locks = _indexing_lock()

    def enqueue_current_repair() -> None:
        nonlocal repair_enqueued
        if repair_enqueued:
            return
        _enqueue_current_repair(dataset_id, document_id)
        repair_enqueued = True

    try:
        with locks.hold(
            dataset_index_lock_name(dataset_id), timeout=_LEASE_TIMEOUT_SECONDS, blocking_timeout=30
        ) as dataset_lease:
            with (
                locks.hold(document_index_lock_name(document_id), timeout=_LEASE_TIMEOUT_SECONDS) as document_lease,
                knowledge_task_execution(outbox_id) as delivery_execution,
                _repair_stale_indexing(
                    document_id=document_id,
                    side_effect_started=lambda: external_started,
                    enqueue_repair=enqueue_current_repair,
                ),
            ):
                if delivery_execution is None:
                    return False
                if delivery_execution.recovered_execution:
                    enqueue_current_repair()
                    return True
                delivery_execution.assert_owned()
                dataset_lease.assert_owned()
                document_lease.assert_owned()
                with session_factory.create_session() as session, session.begin():
                    dataset = session.scalar(
                        select(Dataset).where(Dataset.id == dataset_id).with_for_update(of=Dataset).limit(1)
                    )
                    if dataset is None:
                        raise ValueError("Dataset not found")
                    document = session.scalar(
                        select(Document)
                        .where(
                            Document.id == document_id,
                            Document.tenant_id == dataset.tenant_id,
                            Document.dataset_id == dataset.id,
                        )
                        .with_for_update(of=Document)
                        .limit(1)
                    )
                    if document is None:
                        logger.info(click.style(f"Document not found: {document_id}", fg="yellow"))
                        return True
                    current_generation = document.indexing_generation
                    generation_was_supplied = outbox_id is not None or expected_generation is not None
                    if generation_was_supplied and current_generation != expected_generation:
                        logger.info("Skipping stale website sync generation for document %s", document_id)
                        return True
                    if document.data_source_type != "website_crawl":
                        raise ValueError("Document is not a website document")
                    ref = DatasetRef(dataset.tenant_id, dataset.id).document(document.id)
                    document_ref = ref
                    doc_form = document.doc_form

                def assert_owned(
                    *,
                    task_execution: KnowledgeTaskExecutionLease = delivery_execution,
                    dataset_execution: KnowledgeIndexingLease = dataset_lease,
                    document_execution: KnowledgeIndexingLease = document_lease,
                ) -> None:
                    task_execution.assert_owned()
                    dataset_execution.assert_owned()
                    document_execution.assert_owned()
                    documents.assert_indexing_generation(ref, current_generation)

                indexing_execution = DocumentIndexingExecution(
                    current_generation,
                    assert_owned,
                    task_intent_id=delivery_execution.intent_id,
                    task_execution_id=delivery_execution.execution_id,
                )
                assert_owned()

                if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
                    try:
                        features = FeatureService.get_features(ref.dataset.tenant_id)
                        vector_space = features.vector_space
                        assert vector_space is not None
                        if 0 < vector_space.limit <= vector_space.size:
                            raise ValueError(
                                "Your total number of documents plus the number of uploads have over the limit of "
                                "your subscription."
                            )
                    except Exception as error:
                        assert_owned()
                        documents.fail_indexing(ref, str(error), execution=indexing_execution)
                        if outbox_id is not None:
                            raise
                        return True

                logger.info(click.style(f"Start sync website document: {document_id}", fg="green"))
                with session_factory.create_session() as session:
                    dataset = session.scalar(
                        select(Dataset).where(
                            Dataset.id == ref.dataset.dataset_id,
                            Dataset.tenant_id == ref.dataset.tenant_id,
                        )
                    )
                    if dataset is None:
                        raise DocumentIndexingGenerationChangedError(document_id)
                    require_owned_indexing_document(session, ref, execution=indexing_execution)
                    index_node_ids = [
                        str(node_id)
                        for node_id in session.scalars(
                            select(DocumentSegment.index_node_id).where(
                                DocumentSegment.tenant_id == ref.dataset.tenant_id,
                                DocumentSegment.dataset_id == ref.dataset.dataset_id,
                                DocumentSegment.document_id == ref.document_id,
                                DocumentSegment.index_node_id.is_not(None),
                            )
                        ).all()
                    ]
                    if index_node_ids:
                        external_started = True
                        IndexProcessorFactory(doc_form).init_index_processor().clean(
                            dataset,
                            index_node_ids,
                            with_keywords=True,
                            delete_child_chunks=False,
                            session=session,
                        )
                        documents.commit_indexing_phase(session, ref, execution=indexing_execution)
                assert_owned()

                with session_factory.create_session() as session:
                    if lock_dataset_for_child_write(session, ref.dataset) is None:
                        raise DocumentIndexingGenerationChangedError(ref.document_id)
                    document = require_owned_indexing_document(session, ref, execution=indexing_execution, lock=True)
                    cleanup_file_ids = delete_document_segments_for_replacement(session, ref, owner_locks_held=True)
                    if enqueue_upload_file_cleanup(session, ref, cleanup_file_ids) is not None:
                        wake_knowledge_task_dispatcher_after_commit(session)
                    document.indexing_status = IndexingStatus.PARSING
                    document.processing_started_at = naive_utc_now()
                    assert_owned()
                    documents.commit_indexing_phase(session, ref, execution=indexing_execution)

                external_started = True
                indexing_service = build_document_indexing_service(session_factory=session_factory.get_session_maker())
                indexing_service.run([ref], executions={ref.document_id: indexing_execution})
                assert_owned()
                logger.info(
                    click.style(f"Sync document: {document_id} latency: {time.perf_counter() - start_at}", fg="green")
                )
    except KnowledgeIndexingLockBusyError as error:
        if outbox_id is None:
            raise
        if not defer_knowledge_task_before_execution(outbox_id, error=str(error), delay=_LOCK_RETRY_DELAY_SECONDS):
            logger.info("Skipping duplicate or terminal website sync delivery: %s", outbox_id)
            return False
        raise KnowledgeTaskRequeuedError(
            f"website sync {outbox_id} was deferred while its indexing lock is held"
        ) from error
    except DocumentIndexingGenerationChangedError:
        logger.info("Website sync generation changed for document %s", document_id)
        if external_started and document_ref is not None:
            enqueue_current_repair()
    except (KnowledgeIndexingLeaseLostError, KnowledgeTaskExecutionLeaseLostError):
        enqueue_current_repair()
        raise
    except KnowledgeTaskDeliveryHandledError:
        raise
    except Exception as error:
        logger.info(click.style(str(error), fg="yellow"))
        if document_ref is None or indexing_execution is None:
            raise
        try:
            indexing_execution.assert_owned()
        except DocumentIndexingGenerationChangedError:
            if external_started:
                enqueue_current_repair()
            return True
        except (KnowledgeIndexingLeaseLostError, KnowledgeTaskExecutionLeaseLostError):
            enqueue_current_repair()
            raise
        documents.fail_indexing(document_ref, str(error), execution=indexing_execution)
        logger.exception("sync_website_document_indexing_task failed, document_id: %s", document_id)
        if outbox_id is not None:
            raise
    return True


def _enqueue_current_repair(dataset_id: str, document_id: str) -> None:
    with session_factory.create_session() as session:
        owner = session.execute(
            select(Document.tenant_id, Document.dataset_id).where(
                Document.id == document_id,
                Document.dataset_id == dataset_id,
            )
        ).one_or_none()
    if owner is None:
        return
    tenant_id, owned_dataset_id = owner
    SQLAlchemyDocumentRepository(
        session_factory=session_factory.get_session_maker(),
        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
    ).enqueue_current_indexing_repairs(DatasetRef(tenant_id, owned_dataset_id), [document_id])
