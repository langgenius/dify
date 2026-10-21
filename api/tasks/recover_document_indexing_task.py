import logging
import time

import click
from celery import shared_task
from sqlalchemy import select

from core.db.session_factory import session_factory
from extensions.ext_redis import redis_client
from models.dataset import Dataset, Document
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.knowledge.indexing.adapters.execution import build_document_indexing_service
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.indexing.errors import DocumentIndexingGenerationChangedError, DocumentIsPausedError
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    KnowledgeIndexingLeaseLostError,
    KnowledgeIndexingLockBusyError,
    dataset_index_lock_name,
    document_index_lock_name,
)
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.task_outbox.contracts import (
    KnowledgeTaskDeliveryHandledError,
    KnowledgeTaskExecutionLeaseLostError,
    KnowledgeTaskRequeuedError,
)
from services.knowledge.task_outbox.execution import KnowledgeTaskExecutionLease
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit
from tasks.document_legacy_conversion import convert_legacy_document_indexing_delivery
from tasks.knowledge_task_outbox_task import defer_knowledge_task_before_execution, knowledge_task_execution

logger = logging.getLogger(__name__)
_LEASE_TIMEOUT_SECONDS = 600
_LOCK_RETRY_DELAY_SECONDS = 10


def _indexing_lock() -> RedisKnowledgeIndexingLock:
    return RedisKnowledgeIndexingLock(redis=redis_client)


@shared_task(
    queue="dataset",
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(Exception,),
    dont_autoretry_for=(KnowledgeTaskDeliveryHandledError,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 10},
)
def recover_document_indexing_task(
    dataset_id: str,
    document_id: str,
    expected_generation: str | None = None,
    outbox_id: str | None = None,
) -> None:
    if expected_generation is None and outbox_id is None:
        convert_legacy_document_indexing_delivery(dataset_id, [document_id])
        return
    locks = _indexing_lock()
    try:
        with locks.hold(
            dataset_index_lock_name(dataset_id), timeout=_LEASE_TIMEOUT_SECONDS, blocking_timeout=30
        ) as dataset_lease:
            with locks.hold(document_index_lock_name(document_id), timeout=_LEASE_TIMEOUT_SECONDS) as document_lease:
                with knowledge_task_execution(outbox_id) as execution:
                    if execution is None:
                        return
                    if execution.recovered_execution:
                        _enqueue_current_repair(dataset_id, document_id)
                        return
                    execution.assert_owned()
                    _run_recover_document_indexing(
                        dataset_id,
                        document_id,
                        expected_generation,
                        outbox_id,
                        delivery_execution=execution,
                        dataset_lease=dataset_lease,
                        document_lease=document_lease,
                    )
    except KnowledgeIndexingLockBusyError as error:
        if outbox_id is None:
            raise
        if not defer_knowledge_task_before_execution(outbox_id, error=str(error), delay=_LOCK_RETRY_DELAY_SECONDS):
            logger.info("Skipping duplicate or terminal recovery delivery: %s", outbox_id)
            return
        raise KnowledgeTaskRequeuedError(
            f"document recovery {outbox_id} was deferred while its indexing lock is held"
        ) from error
    except (KnowledgeIndexingLeaseLostError, KnowledgeTaskExecutionLeaseLostError):
        _enqueue_current_repair(dataset_id, document_id)
        raise


def _run_recover_document_indexing(
    dataset_id: str,
    document_id: str,
    expected_generation: str | None,
    outbox_id: str | None,
    *,
    delivery_execution: KnowledgeTaskExecutionLease,
    dataset_lease: KnowledgeIndexingLease,
    document_lease: KnowledgeIndexingLease,
) -> None:
    """
    Async recover document
    :param dataset_id:
    :param document_id:

    Usage: recover_document_indexing_task.delay(dataset_id, document_id)
    """
    logger.info(click.style(f"Recover document: {document_id}", fg="green"))
    start_at = time.perf_counter()

    document_ref = None
    external_started = False
    documents = SQLAlchemyDocumentRepository(
        session_factory=session_factory.get_session_maker(),
        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
    )
    try:
        delivery_execution.assert_owned()
        dataset_lease.assert_owned()
        document_lease.assert_owned()
        with session_factory.create_session() as session, session.begin():
            dataset = session.scalar(
                select(Dataset).where(Dataset.id == dataset_id).with_for_update(of=Dataset).limit(1)
            )
            if dataset is None:
                logger.info(click.style(f"Dataset not found: {dataset_id}", fg="red"))
                return
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
                logger.info(click.style(f"Document not found: {document_id}", fg="red"))
                return
            current_generation = document.indexing_generation
            generation_was_supplied = outbox_id is not None or expected_generation is not None
            if generation_was_supplied and current_generation != expected_generation:
                logger.info("Skipping stale recovery generation for document %s", document_id)
                return
            ref = DatasetRef(document.tenant_id, document.dataset_id).document(document.id)
            document_ref = ref
            status = document.indexing_status

        def assert_owned() -> None:
            delivery_execution.assert_owned()
            dataset_lease.assert_owned()
            document_lease.assert_owned()
            documents.assert_indexing_generation(ref, current_generation)

        indexing_execution = DocumentIndexingExecution(
            current_generation,
            assert_owned,
            task_intent_id=delivery_execution.intent_id,
            task_execution_id=delivery_execution.execution_id,
        )
        assert_owned()
        indexing_service = build_document_indexing_service(session_factory=session_factory.get_session_maker())
        if status in {"waiting", "parsing", "cleaning"}:
            external_started = True
            indexing_service.run([ref], executions={ref.document_id: indexing_execution})
        elif status == "splitting":
            external_started = True
            indexing_service.run_in_splitting_status(ref, execution=indexing_execution)
        elif status == "indexing":
            external_started = True
            indexing_service.run_in_indexing_status(ref, execution=indexing_execution)
        assert_owned()
        end_at = time.perf_counter()
        logger.info(click.style(f"Processed document: {document_id} latency: {end_at - start_at}", fg="green"))
    except DocumentIndexingGenerationChangedError:
        logger.info("Recovery generation changed for document %s", document_id)
        if external_started and document_ref is not None:
            documents.enqueue_current_indexing_repairs(document_ref.dataset, [document_ref.document_id])
    except (KnowledgeIndexingLeaseLostError, KnowledgeTaskExecutionLeaseLostError):
        raise
    except DocumentIsPausedError as ex:
        logger.info(click.style(str(ex), fg="yellow"))
        if outbox_id is not None:
            raise
    except Exception:
        logger.exception("recover_document_indexing_task failed, document_id: %s", document_id)
        if outbox_id is not None:
            raise


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
