import logging

from celery import shared_task
from sqlalchemy import and_, select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.schedule_utils import calculate_next_run_at
from models.workflow import AppTrigger, AppTriggerStatus, WorkflowSchedulePlan
from services.workflow.queue_dispatcher import QueueDispatcherManager
from tasks.workflow_schedule_tasks import run_schedule_trigger

logger = logging.getLogger(__name__)


@shared_task(queue="schedule")
def poll_workflow_schedules() -> None:
    """
    Poll and process due workflow schedules.

    Simple 2-step flow:
    1. Fetch due schedules
    2. Process valid schedules
    """
    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)

    with session_factory() as session:
        due_schedules = _fetch_due_schedules(session)

        if due_schedules:
            dispatched_count, rate_limited_count = _process_schedules(session, due_schedules)
            logger.info(
                "Processed %d/%d schedules (%d skipped due to rate limit)",
                dispatched_count,
                len(due_schedules),
                rate_limited_count,
            )


def _fetch_due_schedules(session: Session) -> list[WorkflowSchedulePlan]:
    """Fetch all schedules that are due for execution."""
    now = naive_utc_now()

    due_schedules = session.scalars(
        (
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
        .with_for_update(skip_locked=True)
        .limit(dify_config.WORKFLOW_SCHEDULE_POLLER_BATCH_SIZE)
    )

    return list(due_schedules)


def _process_schedules(session: Session, schedules: list[WorkflowSchedulePlan]) -> tuple[int, int]:
    """Process schedules: check quota, update next run time and dispatch to Celery."""
    if not schedules:
        return 0, 0

    dispatched_count = 0
    rate_limited_count = 0
    dispatcher_manager = QueueDispatcherManager()

    for schedule in schedules:
        next_run_at = calculate_next_run_at(
            schedule.cron_expression,
            schedule.timezone,
        )

        schedule.next_run_at = next_run_at

        dispatcher = dispatcher_manager.get_dispatcher(schedule.tenant_id)

        if not dispatcher.check_daily_quota(schedule.tenant_id):
            logger.info("Tenant %s rate limited, skipping schedule_plan %s", schedule.tenant_id, schedule.id)
            rate_limited_count += 1
        else:
            run_schedule_trigger.delay(schedule.id)
            dispatched_count += 1

    session.commit()

    return dispatched_count, rate_limited_count
