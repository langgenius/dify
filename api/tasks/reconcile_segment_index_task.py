"""Reconcile child-chunk vectors with the committed segment state."""

import logging

from celery import shared_task

from extensions.ext_redis import redis_client
from services.knowledge.resource_scope import DatasetRef, DocumentRef, SegmentRef
from services.knowledge.segments.application import SegmentMutationService
from services.knowledge.segments.batch_status import transition_batch_to_terminal
from services.knowledge.segments.contracts import SegmentChildIndexCompletion, SegmentIndexReconcileOutcome
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
def reconcile_segment_index_task(
    tenant_id: str,
    dataset_id: str,
    document_id: str,
    segment_id: str,
    delete_node_ids: list[str],
    outbox_id: str,
    parent_generation: str | None = None,
    batch_segment_ids: list[str] | None = None,
    job_id: str | None = None,
    expected_enabled: bool = True,
) -> None:
    segment_ref = SegmentRef(
        document=DocumentRef(
            dataset=DatasetRef(tenant_id=tenant_id, dataset_id=dataset_id),
            document_id=document_id,
        ),
        segment_id=segment_id,
    )
    completion = (
        SegmentChildIndexCompletion(
            generation=parent_generation,
            batch_segment_ids=tuple(batch_segment_ids or (segment_id,)),
            batch_job_id=job_id,
            expected_enabled=expected_enabled,
        )
        if parent_generation is not None
        else None
    )
    mutations = _segment_mutations()
    try:
        with knowledge_task_execution(outbox_id) as execution:
            if execution is None:
                return
            execution.assert_owned()
            if execution.recovered_execution:
                repaired = mutations.enqueue_child_reconcile_repair(
                    segment_ref,
                    delete_node_ids=delete_node_ids,
                    completion=completion,
                )
                logger.warning(
                    "Recovered child reconcile execution scheduled current repair segment_id=%s repaired=%s",
                    segment_id,
                    repaired,
                )
                return
            outcome = mutations.reconcile_children_index(
                segment_ref,
                delete_node_ids=delete_node_ids,
                completion=completion,
                assert_owned=execution.assert_owned,
            )
            execution.assert_owned()
            if job_id is not None:
                if outcome == SegmentIndexReconcileOutcome.COMPLETED:
                    transition_batch_to_terminal(redis_client, job_id, "completed")
                elif outcome == SegmentIndexReconcileOutcome.CANCELLED:
                    transition_batch_to_terminal(redis_client, job_id, "error")
    except KnowledgeTaskRetriesExhaustedError as error:
        if completion is not None:
            failed = mutations.fail_child_reconcile(
                segment_ref,
                completion=completion,
                error=str(error.__cause__ or error),
            )
            if failed and job_id is not None:
                transition_batch_to_terminal(redis_client, job_id, "error")
        raise
