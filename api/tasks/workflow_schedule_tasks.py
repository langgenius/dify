import logging
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from celery import shared_task
from sqlalchemy.orm import sessionmaker

from extensions.ext_database import db
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import WorkflowSchedulePlan
from services.async_workflow_service import AsyncWorkflowService
from services.workflow.entities import AsyncTriggerResponse, TriggerData
from services.workflow.schedule_manager import ScheduleService

logger = logging.getLogger(__name__)


@shared_task(queue="schedule")
def run_schedule_trigger(schedule_id: str) -> AsyncTriggerResponse | None:
    """
    Execute a scheduled workflow trigger.

    Note: No retry logic needed as schedules will run again at next interval.
    Failed executions are logged but don't block future runs.
    """
    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)

    with session_factory() as session:
        schedule = session.get(WorkflowSchedulePlan, schedule_id)
        if not schedule:
            logger.warning("Schedule %s not found", schedule_id)
            return

        if not schedule.enabled:
            logger.debug("Schedule %s is disabled", schedule_id)
            return

        tenant_owner = ScheduleService.get_tenant_owner(session, schedule.tenant_id)
        if not tenant_owner:
            logger.error("Tenant owner not found for tenant %s", schedule.tenant_id)
            return

        try:
            current_utc = datetime.now(UTC)
            schedule_tz = ZoneInfo(schedule.timezone) if schedule.timezone else UTC
            current_in_tz = current_utc.astimezone(schedule_tz)
            inputs = {"current_time": current_in_tz.isoformat()}

            response = AsyncWorkflowService.trigger_workflow_async(
                session=session,
                user=tenant_owner,
                trigger_data=TriggerData(
                    app_id=schedule.app_id,
                    root_node_id=schedule.node_id,
                    # TODO: need `workflow_id` when triggered_by = `debugger`
                    trigger_type=WorkflowRunTriggeredFrom.SCHEDULE,
                    inputs=inputs,
                    tenant_id=schedule.tenant_id,
                ),
            )
            logger.info("Schedule %s triggered workflow: %s", schedule_id, response.workflow_trigger_log_id)
            return response

        except Exception as e:
            logger.error("Failed to trigger workflow for schedule %s: %s", schedule_id, e, exc_info=True)
