"""Queue trigger executions using detached inputs and bounded persistence operations."""

import logging
from collections.abc import Callable, Mapping, Sequence
from typing import Protocol

from enums import QuotaType
from models.enums import WorkflowTriggerStatus
from services.errors.app import QuotaExceededError
from services.quota_service import QuotaCharge
from services.workflow.entities import AsyncTriggerResponse, TriggerActor, TriggerData, TriggerWorkflowSnapshot

logger = logging.getLogger(__name__)


class TriggerWorkflowQuery(Protocol):
    def get_trigger_workflow(
        self, *, tenant_id: str, app_id: str, workflow_id: str | None
    ) -> TriggerWorkflowSnapshot: ...

    def get_published_trigger_workflows(
        self, *, tenant_id: str, app_ids: Sequence[str]
    ) -> Mapping[str, TriggerWorkflowSnapshot]: ...


class TriggerExecutionLogs(Protocol):
    def create_pending(
        self, *, actor: TriggerActor, trigger_data: TriggerData, workflow_id: str, queue: str
    ) -> str: ...

    def mark_failed(
        self, *, tenant_id: str, app_id: str, log_id: str, status: WorkflowTriggerStatus, error: str
    ) -> None: ...

    def mark_queued(self, *, tenant_id: str, app_id: str, log_id: str, task_id: str) -> None: ...

    def record_invocation_failure(
        self,
        *,
        workflow: TriggerWorkflowSnapshot,
        actor: TriggerActor,
        trigger_data: TriggerData,
        failure_inputs: Mapping[str, str],
        error: str,
        queue: str,
    ) -> None: ...


class TriggerWorkflowDispatcher(Protocol):
    def trigger_workflow_async(self, *, actor: TriggerActor, trigger_data: TriggerData) -> AsyncTriggerResponse: ...


class WorkflowQueuePublisher(Protocol):
    def get_queue(self, tenant_id: str) -> str: ...

    def publish(self, *, queue: str, trigger_log_id: str) -> str: ...


class AsyncWorkflowService:
    """Create execution logs and enqueue tasks without retaining a database session.

    Log creation, quota reservation, broker publication and final status are distinct
    steps, as before. This is not an outbox: broker publication can still succeed
    before recording its task ID fails.
    """

    def __init__(
        self,
        *,
        workflows: TriggerWorkflowQuery,
        logs: TriggerExecutionLogs,
        queues: WorkflowQueuePublisher,
        reserve_quota: Callable[[QuotaType, str], QuotaCharge],
    ) -> None:
        self._workflows = workflows
        self._logs = logs
        self._queues = queues
        self._reserve_quota = reserve_quota

    def trigger_workflow_async(self, *, actor: TriggerActor, trigger_data: TriggerData) -> AsyncTriggerResponse:
        workflow = self._workflows.get_trigger_workflow(
            tenant_id=trigger_data.tenant_id, app_id=trigger_data.app_id, workflow_id=trigger_data.workflow_id
        )
        queue = self._queues.get_queue(trigger_data.tenant_id)
        log_id = self._logs.create_pending(actor=actor, trigger_data=trigger_data, workflow_id=workflow.id, queue=queue)
        try:
            charge = self._reserve_quota(QuotaType.WORKFLOW, trigger_data.tenant_id)
        except QuotaExceededError as exc:
            self._logs.mark_failed(
                tenant_id=trigger_data.tenant_id,
                app_id=trigger_data.app_id,
                log_id=log_id,
                status=WorkflowTriggerStatus.RATE_LIMITED,
                error=f"Quota limit reached: {exc}",
            )
            logger.info(
                "Workflow quota exceeded for tenant %s, app %s, trigger log %s",
                trigger_data.tenant_id,
                trigger_data.app_id,
                log_id,
            )
            raise
        try:
            task_id = self._queues.publish(queue=queue, trigger_log_id=log_id)
            charge.commit()
        except Exception as exc:
            # Refund even when recording the publication failure also fails.
            try:
                self._logs.mark_failed(
                    tenant_id=trigger_data.tenant_id,
                    app_id=trigger_data.app_id,
                    log_id=log_id,
                    status=WorkflowTriggerStatus.FAILED,
                    error=f"Failed to dispatch workflow task: {exc}",
                )
            finally:
                charge.refund()
            logger.exception(
                "Failed to dispatch workflow task for tenant %s, app %s, trigger log %s",
                trigger_data.tenant_id,
                trigger_data.app_id,
                log_id,
            )
            raise
        self._logs.mark_queued(
            tenant_id=trigger_data.tenant_id, app_id=trigger_data.app_id, log_id=log_id, task_id=task_id
        )
        return AsyncTriggerResponse(workflow_trigger_log_id=log_id, task_id=task_id, status="queued", queue=queue)
