import logging
from datetime import UTC, datetime

from celery import shared_task
from sqlalchemy import and_, select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from extensions.ext_database import db
from models.workflow import AppTrigger, AppTriggerStatus, WorkflowSchedulePlan
from services.schedule_service import ScheduleService
from services.workflow.queue_dispatcher import QueueDispatcherManager
from tasks.workflow_schedule_tasks import run_schedule_trigger

logger = logging.getLogger(__name__)


@shared_task(queue="schedule")
def poll_workflow_schedules() -> None:
    """
    Poll and process due workflow schedules.

    Simple 3-step flow:
    1. Get rate-limited tenants from Redis
    2. Fetch due schedules excluding rate-limited tenants
    3. Process and dispatch valid schedules
    """
    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)

    with session_factory() as session:
        rate_limited_tenants = _get_rate_limited_tenants(session)
        due_schedules = _fetch_due_schedules(session, exclude_tenants=rate_limited_tenants)

        if due_schedules:
            processed = _process_schedules(session, due_schedules)
            logger.info(
                "Processed %d/%d schedules (%d tenants rate-limited)",
                processed,
                len(due_schedules),
                len(rate_limited_tenants),
            )


def _get_rate_limited_tenants(session: Session) -> set[str]:
    """Get tenants that have reached their daily rate limit."""
    now = datetime.now(UTC)

    tenant_ids = session.scalars(
        select(WorkflowSchedulePlan.tenant_id)
        .distinct()
        .where(
            WorkflowSchedulePlan.next_run_at <= now,
            WorkflowSchedulePlan.next_run_at.isnot(None),
        )
    ).all()

    if not tenant_ids:
        return set()

    dispatcher_manager = QueueDispatcherManager()
    return {
        tenant_id
        for tenant_id in tenant_ids
        if not dispatcher_manager.get_dispatcher(tenant_id).check_daily_quota(tenant_id)
    }


def _fetch_due_schedules(session: Session, exclude_tenants: set[str]) -> list[WorkflowSchedulePlan]:
    """Fetch all schedules that are due for execution, excluding rate-limited tenants."""
    now = datetime.now(UTC)

    query = (
        select(WorkflowSchedulePlan)
        .join(
            AppTrigger,
            and_(
                AppTrigger.app_id == WorkflowSchedulePlan.app_id,
                AppTrigger.node_id == WorkflowSchedulePlan.node_id,
                AppTrigger.trigger_type == "trigger-schedule",
            ),
        )
        .where(
            WorkflowSchedulePlan.next_run_at <= now,
            WorkflowSchedulePlan.next_run_at.isnot(None),
            AppTrigger.status == AppTriggerStatus.ENABLED,
        )
    )

    if exclude_tenants:
        query = query.where(WorkflowSchedulePlan.tenant_id.notin_(exclude_tenants))

    return list(
        session.scalars(query.with_for_update(skip_locked=True).limit(dify_config.WORKFLOW_SCHEDULE_POLLER_BATCH_SIZE))
    )


def _process_schedules(session: Session, schedules: list[WorkflowSchedulePlan]) -> int:
    """Process schedules: update next run time and dispatch to Celery."""
    if not schedules:
        return 0

    dispatched = 0

    for schedule in schedules:
        next_run_at = ScheduleService.calculate_next_run_at(
            schedule.cron_expression,
            schedule.timezone,
        )

        if next_run_at:
            schedule.next_run_at = next_run_at
            run_schedule_trigger.delay(schedule.id)
            dispatched += 1

    session.commit()

    return dispatched
