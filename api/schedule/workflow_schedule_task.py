import logging
from collections import defaultdict
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
    """Poll and process due workflow schedules."""
    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)

    with session_factory() as session:
        due_schedules = _fetch_due_schedules(session)

        if due_schedules:
            logger.info("Processing %d due schedules", len(due_schedules))
            processed = _process_schedules(session, due_schedules)
            if processed:
                logger.info("Successfully dispatched %d schedules", processed)


def _fetch_due_schedules(session: Session) -> list[WorkflowSchedulePlan]:
    """Fetch all schedules that are due for execution."""
    now = datetime.now(UTC)

    return list(
        session.scalars(
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
            .with_for_update(skip_locked=True)
            .limit(dify_config.WORKFLOW_SCHEDULE_POLLER_BATCH_SIZE)
        ).all()
    )


def _process_schedules(session: Session, schedules: list[WorkflowSchedulePlan]) -> int:
    """Process schedules with rate limiting and two-phase commit."""
    if not schedules:
        return 0

    start_time = datetime.now(UTC)

    schedules_by_tenant = _group_by_tenant(schedules)

    dispatch_list, removal_list, rate_limited = _prepare_schedule_updates(schedules_by_tenant)

    if not _commit_schedule_updates(session, dispatch_list, removal_list):
        return 0

    dispatched_count = _dispatch_schedules(dispatch_list, rate_limited)

    _log_batch_summary(
        total_count=len(schedules),
        dispatched_count=dispatched_count,
        removal_count=len(removal_list),
        rate_limited_tenants=rate_limited,
        elapsed_time=(datetime.now(UTC) - start_time).total_seconds(),
    )

    return dispatched_count


def _group_by_tenant(schedules: list[WorkflowSchedulePlan]) -> dict[str, list[WorkflowSchedulePlan]]:
    """Group schedules by tenant ID for efficient processing."""
    schedules_by_tenant = defaultdict(list)
    for schedule in schedules:
        schedules_by_tenant[schedule.tenant_id].append(schedule)
    return schedules_by_tenant


def _prepare_schedule_updates(
    schedules_by_tenant: dict[str, list[WorkflowSchedulePlan]],
) -> tuple[list[WorkflowSchedulePlan], list[WorkflowSchedulePlan], set[str]]:
    """
    Process schedules and check rate limits.

    Returns:
        Tuple of (schedules_to_dispatch, schedules_to_remove, rate_limited_tenants)
    """
    schedules_to_dispatch = []
    schedules_to_remove = []
    rate_limited_tenants = set()

    dispatcher_manager = QueueDispatcherManager()

    for tenant_id, tenant_schedules in schedules_by_tenant.items():
        if _is_tenant_rate_limited(tenant_id, dispatcher_manager):
            rate_limited_tenants.add(tenant_id)
            logger.warning("Tenant %s reached daily limit, skipping %d schedules", tenant_id, len(tenant_schedules))
            continue

        for schedule in tenant_schedules:
            next_run_at = ScheduleService.calculate_next_run_at(
                schedule.cron_expression,
                schedule.timezone,
            )

            if next_run_at:
                schedule.next_run_at = next_run_at
                schedules_to_dispatch.append(schedule)
            else:
                schedules_to_remove.append(schedule)

    return schedules_to_dispatch, schedules_to_remove, rate_limited_tenants


def _is_tenant_rate_limited(tenant_id: str, dispatcher_manager: QueueDispatcherManager) -> bool:
    """Check if tenant has reached daily rate limit."""
    dispatcher = dispatcher_manager.get_dispatcher(tenant_id)
    return not dispatcher.check_daily_quota(tenant_id)


def _commit_schedule_updates(
    session: Session, schedules_to_dispatch: list[WorkflowSchedulePlan], schedules_to_remove: list[WorkflowSchedulePlan]
) -> bool:
    """
    Commit schedule updates to database.

    Returns:
        True if commit successful, False otherwise
    """
    for schedule in schedules_to_remove:
        session.delete(schedule)

    try:
        session.commit()
        return True
    except Exception as e:
        total_count = len(schedules_to_dispatch) + len(schedules_to_remove)
        logger.error("Failed to commit %d schedule updates: %s", total_count, e, exc_info=True)
        session.rollback()
        return False


def _dispatch_schedules(schedules_to_dispatch: list[WorkflowSchedulePlan], rate_limited_tenants: set[str]) -> int:
    """
    Dispatch schedules to Celery for execution.

    Returns:
        Number of successfully dispatched schedules
    """
    dispatched_count = 0

    for schedule in schedules_to_dispatch:
        # Skip if tenant was rate limited
        if schedule.tenant_id in rate_limited_tenants:
            continue

        try:
            run_schedule_trigger.delay(schedule.id)
            dispatched_count += 1
        except Exception as e:
            logger.error("Failed to dispatch schedule %s: %s", schedule.id, e, exc_info=True)

    return dispatched_count


def _log_batch_summary(
    total_count: int, dispatched_count: int, removal_count: int, rate_limited_tenants: set[str], elapsed_time: float
) -> None:
    """Log a summary of the batch processing."""
    summary_parts = [f"{dispatched_count} dispatched"]

    if rate_limited_tenants:
        summary_parts.append(f"{len(rate_limited_tenants)} tenants rate-limited")

    if removal_count > 0:
        summary_parts.append(f"{removal_count} expired")

    logger.info(
        "Batch completed: %d processed (%s) in %.3fs",
        total_count,
        ", ".join(summary_parts),
        elapsed_time,
    )
