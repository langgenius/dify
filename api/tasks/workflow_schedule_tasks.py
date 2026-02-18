import logging

from celery import shared_task

from core.db.session_factory import session_factory
from core.workflow.nodes.trigger_schedule.exc import (
    ScheduleExecutionError,
    ScheduleNotFoundError,
    TenantOwnerNotFoundError,
)
from enums.quota_type import QuotaType, unlimited
from models.trigger import WorkflowSchedulePlan
from services.async_workflow_service import AsyncWorkflowService
from services.errors.app import QuotaExceededError
from services.trigger.app_trigger_service import AppTriggerService
from services.trigger.schedule_service import ScheduleService
from services.workflow.entities import ScheduleTriggerData

logger = logging.getLogger(__name__)


@shared_task(queue="schedule_executor")
def run_schedule_trigger(schedule_id: str) -> None:
    """
    Execute a scheduled workflow trigger.

    Note: No retry logic needed as schedules will run again at next interval.
    The execution result is tracked via WorkflowTriggerLog.

    Raises:
        ScheduleNotFoundError: If schedule doesn't exist
        TenantOwnerNotFoundError: If no owner/admin for tenant
        ScheduleExecutionError: If workflow trigger fails
    """
    with session_factory.create_session() as session:
        schedule = session.get(WorkflowSchedulePlan, schedule_id)
        if not schedule:
            raise ScheduleNotFoundError(f"Schedule {schedule_id} not found")

        tenant_owner = ScheduleService.get_tenant_owner(session, schedule.tenant_id)
        if not tenant_owner:
            raise TenantOwnerNotFoundError(f"No owner or admin found for tenant {schedule.tenant_id}")

        quota_charge = unlimited()
        try:
            quota_charge = QuotaType.TRIGGER.consume(schedule.tenant_id)
        except QuotaExceededError:
            AppTriggerService.mark_tenant_triggers_rate_limited(schedule.tenant_id)
            logger.info("Tenant %s rate limited, skipping schedule trigger %s", schedule.tenant_id, schedule_id)
            return

        try:
            # Production dispatch: Trigger the workflow normally
            response = AsyncWorkflowService.trigger_workflow_async(
                session=session,
                user=tenant_owner,
                trigger_data=ScheduleTriggerData(
                    app_id=schedule.app_id,
                    root_node_id=schedule.node_id,
                    inputs={},
                    tenant_id=schedule.tenant_id,
                ),
            )
            logger.info("Schedule %s triggered workflow: %s", schedule_id, response.workflow_trigger_log_id)
        except Exception as e:
            quota_charge.refund()
            raise ScheduleExecutionError(
                f"Failed to trigger workflow for schedule {schedule_id}, app {schedule.app_id}"
            ) from e
