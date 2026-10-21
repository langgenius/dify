import logging
from collections.abc import Callable, Sequence

from celery import shared_task

from configs import dify_config
from core.db.session_factory import session_factory
from core.entities.document_task import DocumentTask
from core.rag.pipeline.queue import TenantIsolatedTaskQueue
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.knowledge.indexing.locks import KnowledgeIndexingLockBusyError
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.task_outbox.contracts import (
    KnowledgeTaskDeliveryHandledError,
    KnowledgeTaskRetriesExhaustedError,
)
from services.knowledge.task_outbox.execution import KnowledgeTaskExecutionLease
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit
from services.knowledge.task_outbox.tenant_queue import knowledge_tenant_task_admission
from tasks.document_execution_recovery import repair_recovered_document_execution
from tasks.document_indexing_task import _mark_documents_retry_exhausted, _run_document_indexing_batch
from tasks.document_legacy_conversion import convert_legacy_document_indexing_delivery
from tasks.knowledge_task_outbox_task import knowledge_task_execution

logger = logging.getLogger(__name__)
_LOCK_RETRY_DELAY_SECONDS = 10


@shared_task(
    queue="dataset",
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 10},
)
def duplicate_document_indexing_task(dataset_id: str, document_ids: list):
    """
    Async process document
    :param dataset_id:
    :param document_ids:

    .. warning:: TO BE DEPRECATED
        This function will be deprecated and removed in a future version.
        Use normal_duplicate_document_indexing_task or priority_duplicate_document_indexing_task instead.

    Usage: duplicate_document_indexing_task.delay(dataset_id, document_ids)
    """
    logger.warning("duplicate document indexing task received: %s - %s", dataset_id, document_ids)
    convert_legacy_document_indexing_delivery(dataset_id, document_ids)


def _duplicate_document_indexing_task_with_tenant_queue(
    tenant_id: str,
    dataset_id: str,
    document_ids: Sequence[str],
    task_func: Callable[..., object],
    generations: dict[str, str] | None = None,
    *,
    outbox_id: str | None = None,
    execution: KnowledgeTaskExecutionLease | None = None,
):
    if generations is None and outbox_id is None:
        convert_legacy_document_indexing_delivery(dataset_id, document_ids)
        _advance_legacy_tenant_queue(tenant_id, task_func)
        return
    try:
        _duplicate_document_indexing_task(
            dataset_id,
            document_ids,
            generations,
            outbox_id=outbox_id,
            execution=execution,
            expected_tenant_id=tenant_id,
        )
    except Exception:
        logger.exception(
            "Error processing duplicate document indexing %s for tenant %s: %s",
            dataset_id,
            tenant_id,
            document_ids,
            exc_info=True,
        )
        raise


def _advance_legacy_tenant_queue(tenant_id: str, task_func: Callable[..., object]) -> None:
    tenant_isolated_task_queue = TenantIsolatedTaskQueue(tenant_id, "duplicate_document_indexing")
    next_tasks = tenant_isolated_task_queue.pull_tasks(count=dify_config.TENANT_ISOLATED_TASK_CONCURRENCY)
    logger.info("duplicate document indexing tenant isolation queue %s next tasks: %s", tenant_id, next_tasks)
    if not next_tasks:
        tenant_isolated_task_queue.delete_task_key()
        return
    for next_task in next_tasks:
        document_task = DocumentTask(**next_task)
        tenant_isolated_task_queue.set_task_waiting_time()
        task_func.delay(  # type: ignore
            tenant_id=document_task.tenant_id,
            dataset_id=document_task.dataset_id,
            document_ids=document_task.document_ids,
        )


def _duplicate_document_indexing_task(
    dataset_id: str,
    document_ids: Sequence[str],
    generations: dict[str, str] | None = None,
    *,
    outbox_id: str | None = None,
    execution: KnowledgeTaskExecutionLease | None = None,
    expected_tenant_id: str | None = None,
) -> None:
    _run_document_indexing_batch(
        dataset_id=dataset_id,
        document_ids=document_ids,
        generations=generations or {},
        outbox_id=outbox_id,
        execution=execution,
        expected_tenant_id=expected_tenant_id,
        replace_existing=True,
        count_pending_vectors=True,
        enforce_vector_space_admission=False,
        queue_summaries=False,
    )


def _run_duplicate_document_indexing_delivery(
    *,
    tenant_id: str,
    dataset_id: str,
    document_ids: Sequence[str],
    generations: dict[str, str] | None,
    outbox_id: str | None,
    tenant_queue_receipt: str | None,
    task_func: Callable[..., object],
) -> None:
    with knowledge_tenant_task_admission(tenant_id, tenant_queue_receipt) as admission:
        if admission is None:
            return
        try:
            with knowledge_task_execution(outbox_id, assert_admitted=admission.assert_owned) as execution:
                if execution is None:
                    return
                try:
                    documents = SQLAlchemyDocumentRepository(
                        session_factory=session_factory.get_session_maker(),
                        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
                    )
                    if repair_recovered_document_execution(
                        execution,
                        documents=documents,
                        ref=DatasetRef(tenant_id, dataset_id),
                        document_ids=document_ids,
                    ):
                        return
                    if generations is None and outbox_id is None:
                        _duplicate_document_indexing_task_with_tenant_queue(
                            tenant_id, dataset_id, document_ids, task_func
                        )
                    else:
                        _duplicate_document_indexing_task_with_tenant_queue(
                            tenant_id,
                            dataset_id,
                            document_ids,
                            task_func,
                            generations,
                            outbox_id=outbox_id,
                            execution=execution,
                        )
                except KnowledgeIndexingLockBusyError as error:
                    if outbox_id is None:
                        raise
                    execution.defer(error=str(error), delay_seconds=_LOCK_RETRY_DELAY_SECONDS)
        except KnowledgeTaskRetriesExhaustedError as error:
            _mark_documents_retry_exhausted(
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                generations=generations,
                error=error,
            )
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
def normal_duplicate_document_indexing_task(
    tenant_id: str,
    dataset_id: str,
    document_ids: Sequence[str],
    generations: dict[str, str] | None = None,
    outbox_id: str | None = None,
    tenant_queue_receipt: str | None = None,
) -> None:
    """
    Async process duplicate documents
    :param tenant_id:
    :param dataset_id:
    :param document_ids:

    Usage: normal_duplicate_document_indexing_task.delay(tenant_id, dataset_id, document_ids)
    """
    logger.info("normal duplicate document indexing task received: %s - %s - %s", tenant_id, dataset_id, document_ids)
    _run_duplicate_document_indexing_delivery(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_ids=document_ids,
        generations=generations,
        outbox_id=outbox_id,
        tenant_queue_receipt=tenant_queue_receipt,
        task_func=normal_duplicate_document_indexing_task,
    )


@shared_task(
    queue="priority_dataset",
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(Exception,),
    dont_autoretry_for=(KnowledgeTaskDeliveryHandledError,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 10},
)
def priority_duplicate_document_indexing_task(
    tenant_id: str,
    dataset_id: str,
    document_ids: Sequence[str],
    generations: dict[str, str] | None = None,
    outbox_id: str | None = None,
    tenant_queue_receipt: str | None = None,
) -> None:
    """
    Async process duplicate documents
    :param tenant_id:
    :param dataset_id:
    :param document_ids:

    Usage: priority_duplicate_document_indexing_task.delay(tenant_id, dataset_id, document_ids)
    """
    logger.info("priority duplicate document indexing task received: %s - %s - %s", tenant_id, dataset_id, document_ids)
    _run_duplicate_document_indexing_delivery(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_ids=document_ids,
        generations=generations,
        outbox_id=outbox_id,
        tenant_queue_receipt=tenant_queue_receipt,
        task_func=priority_duplicate_document_indexing_task,
    )
