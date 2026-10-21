"""Durably index segments after their database rows have committed."""

import logging

from celery import shared_task

from extensions.ext_redis import redis_client
from services.knowledge.resource_scope import DatasetRef, DocumentRef
from services.knowledge.segments.application import SegmentMutationService
from services.knowledge.segments.batch_status import transition_batch_to_terminal
from services.knowledge.segments.contracts import SegmentIndexReconcileOutcome
from services.knowledge.task_outbox.contracts import (
    KnowledgeTaskDeliveryHandledError,
    KnowledgeTaskRetriesExhaustedError,
)
from tasks.knowledge_task_outbox_task import knowledge_task_execution

logger = logging.getLogger(__name__)


def _segment_mutations() -> SegmentMutationService:
    # The composition root imports the outbox registry that registers this task.
    from extensions.ext_application_services import application_services

    return application_services().knowledge.segments.mutations


@shared_task(
    queue="dataset",
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=5,
    acks_late=True,
    reject_on_worker_lost=True,
    dont_autoretry_for=(KnowledgeTaskDeliveryHandledError,),
)
def index_created_segments_task(
    tenant_id: str,
    dataset_id: str,
    document_id: str,
    segment_ids: list[str],
    generation: str,
    job_id: str | None,
    outbox_id: str,
) -> None:
    document_ref = DocumentRef(
        dataset=DatasetRef(tenant_id=tenant_id, dataset_id=dataset_id),
        document_id=document_id,
    )
    mutations = _segment_mutations()
    try:
        with knowledge_task_execution(outbox_id) as execution:
            if execution is None:
                return
            execution.assert_owned()
            if execution.recovered_execution:
                repaired = mutations.enqueue_created_segments_repair(
                    document_ref,
                    segment_ids=segment_ids,
                    batch_job_id=job_id,
                )
                logger.warning(
                    "Recovered segment create execution scheduled current repair document_id=%s repaired=%s",
                    document_id,
                    repaired,
                )
                return
            outcome = mutations.reconcile_created_segments(
                document_ref,
                segment_ids=segment_ids,
                generation=generation,
                job_id=job_id,
                assert_owned=execution.assert_owned,
            )
            execution.assert_owned()
            if job_id is not None:
                if outcome == SegmentIndexReconcileOutcome.COMPLETED:
                    transition_batch_to_terminal(redis_client, job_id, "completed")
                elif outcome == SegmentIndexReconcileOutcome.CANCELLED:
                    transition_batch_to_terminal(redis_client, job_id, "error")
    except KnowledgeTaskRetriesExhaustedError as error:
        failed = mutations.fail_created_segments(
            document_ref,
            segment_ids=segment_ids,
            generation=generation,
            error=str(error.__cause__ or error),
        )
        if failed and job_id is not None:
            transition_batch_to_terminal(redis_client, job_id, "error")
        raise
