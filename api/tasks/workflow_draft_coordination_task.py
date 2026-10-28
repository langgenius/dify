"""Existing workflow queue recovery; SQL intent outlives broker messages/retries."""

from celery import shared_task

from configs import dify_config
from services.workflow.draft_coordination_service import WorkflowDraftCoordinationService


@shared_task(queue="workflow")
def process_workflow_draft_coordination(coordination_id: str) -> None:
    try:
        WorkflowDraftCoordinationService.execute(coordination_id)
    except Exception as exc:
        # SQL/ack failures leave the durable lease for the sweep; avoid raw SQL
        # and exception payloads in Celery's default task traceback logging.
        WorkflowDraftCoordinationService._log_failure(coordination_id, "worker", exc)


@shared_task(queue="workflow")
def sweep_workflow_draft_coordination() -> None:
    # Discovery does not claim: a worker must be able to execute immediately.
    try:
        due_ids = WorkflowDraftCoordinationService.due_ids(dify_config.WORKFLOW_DRAFT_COORDINATION_BATCH_SIZE)
    except Exception as exc:
        WorkflowDraftCoordinationService._log_failure("sweep", "discovery", exc)
        return
    for coordination_id in due_ids:
        try:
            process_workflow_draft_coordination.delay(coordination_id)
        except Exception as exc:
            WorkflowDraftCoordinationService._log_failure(coordination_id, "enqueue", exc)
