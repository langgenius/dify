"""Recover committed draft side effects independently of workflow execution tiers.

Periodic discovery uses the shared scheduler queue; per-draft reconciliation
uses workflow storage workers. SQL intent outlives broker messages and retries.
"""

from celery import shared_task

from configs import dify_config
from services.workflow.draft_coordination_service import WorkflowDraftCoordinationService


@shared_task(queue="workflow_storage")
def process_workflow_draft_coordination(coordination_id: str) -> None:
    """Attempt a committed receipt; failures leave durable work for a later sweep."""
    try:
        WorkflowDraftCoordinationService.execute(coordination_id)
    except Exception as exc:
        # SQL/ack failures leave the durable lease for the sweep; avoid raw SQL
        # and exception payloads in Celery's default task traceback logging.
        WorkflowDraftCoordinationService._log_failure(coordination_id, "worker", exc)


@shared_task(queue="schedule_executor")
def sweep_workflow_draft_coordination() -> None:
    """Publish due receipt IDs without claiming or acknowledging their SQL work."""
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
