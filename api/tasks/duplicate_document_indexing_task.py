import logging
import time
from collections.abc import Callable, Sequence

import click
from celery import shared_task
from sqlalchemy import delete, select

from configs import dify_config
from core.db.session_factory import session_factory
from core.entities.document_task import DocumentTask
from core.indexing_runner import DocumentIsPausedError, IndexingRunner
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.pipeline.queue import TenantIsolatedTaskQueue
from enums.cloud_plan import CloudPlan
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment
from services.feature_service import FeatureService

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
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
    _duplicate_document_indexing_task(dataset_id, document_ids)


def _duplicate_document_indexing_task_with_tenant_queue(
    tenant_id: str, dataset_id: str, document_ids: Sequence[str], task_func: Callable[[str, str, Sequence[str]], None]
):
    try:
        _duplicate_document_indexing_task(dataset_id, document_ids)
    except Exception:
        logger.exception(
            "Error processing duplicate document indexing %s for tenant %s: %s",
            dataset_id,
            tenant_id,
            document_ids,
            exc_info=True,
        )
    finally:
        tenant_isolated_task_queue = TenantIsolatedTaskQueue(tenant_id, "duplicate_document_indexing")

        # Check if there are waiting tasks in the queue
        # Use rpop to get the next task from the queue (FIFO order)
        next_tasks = tenant_isolated_task_queue.pull_tasks(count=dify_config.TENANT_ISOLATED_TASK_CONCURRENCY)

        logger.info("duplicate document indexing tenant isolation queue %s next tasks: %s", tenant_id, next_tasks)

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


def _duplicate_document_indexing_task(dataset_id: str, document_ids: Sequence[str]):
    documents: list[Document] = []
    start_at = time.perf_counter()

    with session_factory.create_session() as session:
        try:
            dataset = session.query(Dataset).where(Dataset.id == dataset_id).first()
            if dataset is None:
                logger.info(click.style(f"Dataset not found: {dataset_id}", fg="red"))
                return

            # check document limit
            features = FeatureService.get_features(dataset.tenant_id)
            try:
                if features.billing.enabled:
                    vector_space = features.vector_space
                    count = len(document_ids)
                    if features.billing.subscription.plan == CloudPlan.SANDBOX and count > 1:
                        raise ValueError("Your current plan does not support batch upload, please upgrade your plan.")
                    batch_upload_limit = int(dify_config.BATCH_UPLOAD_LIMIT)
                    if count > batch_upload_limit:
                        raise ValueError(f"You have reached the batch upload limit of {batch_upload_limit}.")
                    current = int(getattr(vector_space, "size", 0) or 0)
                    limit = int(getattr(vector_space, "limit", 0) or 0)
                    if limit > 0 and (current + count) > limit:
                        raise ValueError(
                            "Your total number of documents plus the number of uploads have exceeded the limit of "
                            "your subscription."
                        )
            except Exception as e:
                documents = list(
                    session.scalars(
                        select(Document).where(Document.id.in_(document_ids), Document.dataset_id == dataset_id)
                    ).all()
                )
                for document in documents:
                    if document:
                        document.indexing_status = "error"
                        document.error = str(e)
                        document.stopped_at = naive_utc_now()
                        session.add(document)
                session.commit()
                return

            documents = list(
                session.scalars(
                    select(Document).where(Document.id.in_(document_ids), Document.dataset_id == dataset_id)
                ).all()
            )

            for document in documents:
                logger.info(click.style(f"Start process document: {document.id}", fg="green"))

                # clean old data
                index_type = document.doc_form
                index_processor = IndexProcessorFactory(index_type).init_index_processor()

                segments = session.scalars(
                    select(DocumentSegment).where(DocumentSegment.document_id == document.id)
                ).all()
                if segments:
                    index_node_ids = [segment.index_node_id for segment in segments]

                    # delete from vector index
                    index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=True)

                    segment_ids = [segment.id for segment in segments]
                    segment_delete_stmt = delete(DocumentSegment).where(DocumentSegment.id.in_(segment_ids))
                    session.execute(segment_delete_stmt)
                    session.commit()

                document.indexing_status = "parsing"
                document.processing_started_at = naive_utc_now()
                session.add(document)
            session.commit()

            indexing_runner = IndexingRunner()
            indexing_runner.run(list(documents))
            end_at = time.perf_counter()
            logger.info(click.style(f"Processed dataset: {dataset_id} latency: {end_at - start_at}", fg="green"))
        except DocumentIsPausedError as ex:
            logger.info(click.style(str(ex), fg="yellow"))
        except Exception:
            logger.exception("duplicate_document_indexing_task failed, dataset_id: %s", dataset_id)


@shared_task(queue="dataset")
def normal_duplicate_document_indexing_task(tenant_id: str, dataset_id: str, document_ids: Sequence[str]):
    """
    Async process duplicate documents
    :param tenant_id:
    :param dataset_id:
    :param document_ids:

    Usage: normal_duplicate_document_indexing_task.delay(tenant_id, dataset_id, document_ids)
    """
    logger.info("normal duplicate document indexing task received: %s - %s - %s", tenant_id, dataset_id, document_ids)
    _duplicate_document_indexing_task_with_tenant_queue(
        tenant_id, dataset_id, document_ids, normal_duplicate_document_indexing_task
    )


@shared_task(queue="priority_dataset")
def priority_duplicate_document_indexing_task(tenant_id: str, dataset_id: str, document_ids: Sequence[str]):
    """
    Async process duplicate documents
    :param tenant_id:
    :param dataset_id:
    :param document_ids:

    Usage: priority_duplicate_document_indexing_task.delay(tenant_id, dataset_id, document_ids)
    """
    logger.info("priority duplicate document indexing task received: %s - %s - %s", tenant_id, dataset_id, document_ids)
    _duplicate_document_indexing_task_with_tenant_queue(
        tenant_id, dataset_id, document_ids, priority_duplicate_document_indexing_task
    )
