import logging
import time
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from celery import shared_task
from sqlalchemy.orm import sessionmaker

from core.workflow.nodes.trigger_schedule.exc import (
    ScheduleExecutionError,
    ScheduleNotFoundError,
    TenantOwnerNotFoundError,
)
from extensions.ext_database import db
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import WorkflowSchedulePlan
from services.async_workflow_service import AsyncWorkflowService
from services.trigger.schedule_service import ScheduleService
from services.trigger.trigger_debug_service import ScheduleDebugEvent, TriggerDebugService
from services.workflow.entities import TriggerData

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
    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)

    with session_factory() as session:
        schedule = session.get(WorkflowSchedulePlan, schedule_id)
        if not schedule:
            raise ScheduleNotFoundError(f"Schedule {schedule_id} not found")

        tenant_owner = ScheduleService.get_tenant_owner(session, schedule.tenant_id)
        if not tenant_owner:
            raise TenantOwnerNotFoundError(f"No owner or admin found for tenant {schedule.tenant_id}")

        try:
            current_utc = datetime.now(UTC)
            schedule_tz = ZoneInfo(schedule.timezone) if schedule.timezone else UTC
            current_in_tz = current_utc.astimezone(schedule_tz)
            inputs = {"current_time": current_in_tz.isoformat()}

            # Production dispatch: Trigger the workflow normally
            response = AsyncWorkflowService.trigger_workflow_async(
                session=session,
                user=tenant_owner,
                trigger_data=TriggerData(
                    app_id=schedule.app_id,
                    root_node_id=schedule.node_id,
                    trigger_type=WorkflowRunTriggeredFrom.SCHEDULE,
                    inputs=inputs,
                    tenant_id=schedule.tenant_id,
                ),
            )
            logger.info("Schedule %s triggered workflow: %s", schedule_id, response.workflow_trigger_log_id)

            # Debug dispatch: Send event to waiting debug listeners (if any)
            try:
                event = ScheduleDebugEvent(
                    timestamp=int(time.time()),
                    node_id=schedule.node_id,
                    inputs=inputs,
                )
                pool_key = ScheduleDebugEvent.build_pool_key(
                    tenant_id=schedule.tenant_id,
                    app_id=schedule.app_id,
                    node_id=schedule.node_id,
                )
                dispatched_count = TriggerDebugService.dispatch(
                    tenant_id=schedule.tenant_id,
                    event=event,
                    pool_key=pool_key,
                )
                if dispatched_count > 0:
                    logger.debug(
                        "Dispatched schedule debug event to %d listener(s) for schedule %s",
                        dispatched_count,
                        schedule_id,
                    )
            except Exception as debug_error:
                # Debug dispatch failure should not affect production workflow execution
                logger.warning(
                    "Failed to dispatch debug event for schedule %s: %s",
                    schedule_id,
                    str(debug_error),
                    exc_info=True,
                )

        except Exception as e:
            raise ScheduleExecutionError(
                f"Failed to trigger workflow for schedule {schedule_id}, app {schedule.app_id}"
            ) from e
