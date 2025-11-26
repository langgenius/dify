import logging

from celery import group, shared_task
from sqlalchemy import and_, select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.schedule_utils import calculate_next_run_at
from models.trigger import AppTrigger, AppTriggerStatus, AppTriggerType, WorkflowSchedulePlan
from tasks.workflow_schedule_tasks import run_schedule_trigger

logger = logging.getLogger(__name__)


@shared_task(queue="schedule_poller")
def poll_workflow_schedules() -> None:
    """
    Poll and process due workflow schedules.

    Streaming flow:
    1. Fetch due schedules in batches
    2. Process each batch until all due schedules are handled
    3. Optional: Limit total dispatches per tick as a circuit breaker
    """
    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)

    with session_factory() as session:
        total_dispatched = 0

        # Process in batches until we've handled all due schedules or hit the limit
        while True:
            due_schedules = _fetch_due_schedules(session)

            if not due_schedules:
                break

            dispatched_count = _process_schedules(session, due_schedules)
            total_dispatched += dispatched_count

            logger.debug("Batch processed: %d dispatched", dispatched_count)

            # Circuit breaker: check if we've hit the per-tick limit (if enabled)
            if (
                dify_config.WORKFLOW_SCHEDULE_MAX_DISPATCH_PER_TICK > 0
                and total_dispatched >= dify_config.WORKFLOW_SCHEDULE_MAX_DISPATCH_PER_TICK
            ):
                logger.warning(
                    "Circuit breaker activated: reached dispatch limit (%d), will continue next tick",
                    dify_config.WORKFLOW_SCHEDULE_MAX_DISPATCH_PER_TICK,
                )
                break

        if total_dispatched > 0:
            logger.info("Total processed: %d dispatched", total_dispatched)


def _fetch_due_schedules(session: Session) -> list[WorkflowSchedulePlan]:
    """
    Fetch a batch of due schedules, sorted by most overdue first.

    Returns up to WORKFLOW_SCHEDULE_POLLER_BATCH_SIZE schedules per call.
    Used in a loop to progressively process all due schedules.
    """
    now = naive_utc_now()

    due_schedules = session.scalars(
        (
            select(WorkflowSchedulePlan)
            .join(
                AppTrigger,
                and_(
                    AppTrigger.app_id == WorkflowSchedulePlan.app_id,
                    AppTrigger.node_id == WorkflowSchedulePlan.node_id,
                    AppTrigger.trigger_type == AppTriggerType.TRIGGER_SCHEDULE,
                ),
            )
            .where(
                WorkflowSchedulePlan.next_run_at <= now,
                WorkflowSchedulePlan.next_run_at.isnot(None),
                AppTrigger.status == AppTriggerStatus.ENABLED,
            )
        )
        .order_by(WorkflowSchedulePlan.next_run_at.asc())
        .with_for_update(skip_locked=True)
        .limit(dify_config.WORKFLOW_SCHEDULE_POLLER_BATCH_SIZE)
    )

    return list(due_schedules)


def _process_schedules(session: Session, schedules: list[WorkflowSchedulePlan]) -> int:
    """Process schedules: check quota, update next run time and dispatch to Celery in parallel."""
    if not schedules:
        return 0

    tasks_to_dispatch: list[str] = []
    for schedule in schedules:
        next_run_at = calculate_next_run_at(
            schedule.cron_expression,
            schedule.timezone,
        )
        schedule.next_run_at = next_run_at

        tasks_to_dispatch.append(schedule.id)

    if tasks_to_dispatch:
        job = group(run_schedule_trigger.s(schedule_id) for schedule_id in tasks_to_dispatch)
        job.apply_async()

        logger.debug("Dispatched %d tasks in parallel", len(tasks_to_dispatch))

    session.commit()

    return len(tasks_to_dispatch)
