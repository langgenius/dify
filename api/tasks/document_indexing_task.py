import logging
import time
from collections.abc import Callable, Sequence

import click
from celery import shared_task

from configs import dify_config
from core.db.session_factory import session_factory
from core.entities.document_task import DocumentTask
from core.indexing_runner import DocumentIsPausedError, IndexingRunner
from core.rag.pipeline.queue import TenantIsolatedTaskQueue
from enums.cloud_plan import CloudPlan
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document
from services.feature_service import FeatureService

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def document_indexing_task(dataset_id: str, document_ids: list):
    """
    Async process document
    :param dataset_id:
    :param document_ids:

    .. warning:: TO BE DEPRECATED
        This function will be deprecated and removed in a future version.
        Use normal_document_indexing_task or priority_document_indexing_task instead.

    Usage: document_indexing_task.delay(dataset_id, document_ids)
    """
    logger.warning("document indexing legacy mode received: %s - %s", dataset_id, document_ids)
    _document_indexing(dataset_id, document_ids)


def _document_indexing(dataset_id: str, document_ids: Sequence[str]):
    """
    Process document for tasks
    :param dataset_id:
    :param document_ids:

    Usage: _document_indexing(dataset_id, document_ids)
    """
    documents = []
    start_at = time.perf_counter()

    with session_factory.create_session() as session:
        dataset = session.query(Dataset).where(Dataset.id == dataset_id).first()
        if not dataset:
            logger.info(click.style(f"Dataset is not found: {dataset_id}", fg="yellow"))
            return
        # check document limit
        features = FeatureService.get_features(dataset.tenant_id)
        try:
            if features.billing.enabled:
                vector_space = features.vector_space
                count = len(document_ids)
                batch_upload_limit = int(dify_config.BATCH_UPLOAD_LIMIT)
                if features.billing.subscription.plan == CloudPlan.SANDBOX and count > 1:
                    raise ValueError("Your current plan does not support batch upload, please upgrade your plan.")
                if count > batch_upload_limit:
                    raise ValueError(f"You have reached the batch upload limit of {batch_upload_limit}.")
                if 0 < vector_space.limit <= vector_space.size:
                    raise ValueError(
                        "Your total number of documents plus the number of uploads have over the limit of "
                        "your subscription."
                    )
        except Exception as e:
            for document_id in document_ids:
                document = (
                    session.query(Document).where(Document.id == document_id, Document.dataset_id == dataset_id).first()
                )
                if document:
                    document.indexing_status = "error"
                    document.error = str(e)
                    document.stopped_at = naive_utc_now()
                    session.add(document)
            session.commit()
            return

        for document_id in document_ids:
            logger.info(click.style(f"Start process document: {document_id}", fg="green"))

            document = (
                session.query(Document).where(Document.id == document_id, Document.dataset_id == dataset_id).first()
            )

            if document:
                document.indexing_status = "parsing"
                document.processing_started_at = naive_utc_now()
                documents.append(document)
                session.add(document)
        session.commit()

        try:
            indexing_runner = IndexingRunner()
            indexing_runner.run(documents)
            end_at = time.perf_counter()
            logger.info(click.style(f"Processed dataset: {dataset_id} latency: {end_at - start_at}", fg="green"))
        except DocumentIsPausedError as ex:
            logger.info(click.style(str(ex), fg="yellow"))
        except Exception:
            logger.exception("Document indexing task failed, dataset_id: %s", dataset_id)


def _document_indexing_with_tenant_queue(
    tenant_id: str, dataset_id: str, document_ids: Sequence[str], task_func: Callable[[str, str, Sequence[str]], None]
):
    try:
        _document_indexing(dataset_id, document_ids)
    except Exception:
        logger.exception(
            "Error processing document indexing %s for tenant %s: %s",
            dataset_id,
            tenant_id,
            document_ids,
            exc_info=True,
        )
    finally:
        tenant_isolated_task_queue = TenantIsolatedTaskQueue(tenant_id, "document_indexing")

        # Check if there are waiting tasks in the queue
        # Use rpop to get the next task from the queue (FIFO order)
        next_tasks = tenant_isolated_task_queue.pull_tasks(count=dify_config.TENANT_ISOLATED_TASK_CONCURRENCY)

        logger.info("document indexing tenant isolation queue %s next tasks: %s", tenant_id, next_tasks)

        if next_tasks:
            for next_task in next_tasks:
                document_task = DocumentTask(**next_task)
                # Process the next waiting task
                # Keep the flag set to indicate a task is running
                tenant_isolated_task_queue.set_task_waiting_time()
                task_func.delay(  # type: ignore
                    tenant_id=document_task.tenant_id,
                    dataset_id=document_task.dataset_id,
                    document_ids=document_task.document_ids,
                )
        else:
            # No more waiting tasks, clear the flag
            tenant_isolated_task_queue.delete_task_key()


@shared_task(queue="dataset")
def normal_document_indexing_task(tenant_id: str, dataset_id: str, document_ids: Sequence[str]):
    """
    Async process document
    :param tenant_id:
    :param dataset_id:
    :param document_ids:

    Usage: normal_document_indexing_task.delay(tenant_id, dataset_id, document_ids)
    """
    logger.info("normal document indexing task received: %s - %s - %s", tenant_id, dataset_id, document_ids)
    _document_indexing_with_tenant_queue(tenant_id, dataset_id, document_ids, normal_document_indexing_task)


@shared_task(queue="priority_dataset")
def priority_document_indexing_task(tenant_id: str, dataset_id: str, document_ids: Sequence[str]):
    """
    Priority async process document
    :param tenant_id:
    :param dataset_id:
    :param document_ids:

    Usage: priority_document_indexing_task.delay(tenant_id, dataset_id, document_ids)
    """
    logger.info("priority document indexing task received: %s - %s - %s", tenant_id, dataset_id, document_ids)
    _document_indexing_with_tenant_queue(tenant_id, dataset_id, document_ids, priority_document_indexing_task)
