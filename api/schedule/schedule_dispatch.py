import logging
import os
import time
from datetime import UTC, datetime

import sqlalchemy as sa
from celery.beat import Scheduler
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from configs import dify_config
from models.workflow import WorkflowSchedulePlan
from services.workflow.schedule_manager import ScheduleService
from tasks.workflow_schedule_tasks import run_schedule_trigger

logger = logging.getLogger(__name__)

# Standalone engine because Beat runs in separate process without Flask context
engine = create_engine(
    dify_config.SQLALCHEMY_DATABASE_URI,
    pool_pre_ping=True,
    pool_recycle=300,
    # pool_size=2,  # Small pool for Beat's limited concurrent needs
    # max_overflow=3,  # Allow a few extra connections if needed
    # pool_timeout=10,  # Fail fast if pool exhausted
)


class WorkflowScheduler(Scheduler):
    """
    Celery Beat scheduler for workflow schedule triggers.

    Features:
    - Dynamic schedule configuration from database
    - High availability support with SKIP LOCKED
    - Real-time schedule updates without restart
    - Misfire handling with grace period
    """

    def __init__(self, *args, **kwargs):
        # Must initialize before super() because setup_schedule() needs these
        self._last_sync = None
        self.sync_every = int(os.getenv("WORKFLOW_SCHEDULER_SYNC_EVERY", "60"))
        self.misfire_grace_time = int(os.getenv("WORKFLOW_SCHEDULER_MISFIRE_GRACE", "300"))
        self.min_tick_interval = float(os.getenv("WORKFLOW_SCHEDULER_MIN_TICK", "5.0"))
        self.max_tick_interval = float(os.getenv("WORKFLOW_SCHEDULER_MAX_TICK", "60.0"))
        self.batch_size = int(os.getenv("WORKFLOW_SCHEDULER_BATCH_SIZE", "100"))

        logger.info(
            "WorkflowScheduler initialized with: sync_every=%ds, "
            "misfire_grace=%ds, tick_interval=[%.1f, %.1f]s, batch_size=%d",
            self.sync_every,
            self.misfire_grace_time,
            self.min_tick_interval,
            self.max_tick_interval,
            self.batch_size,
        )

        super().__init__(*args, **kwargs)

    @staticmethod
    def ensure_utc(dt):
        """Ensure datetime is UTC-aware."""
        if dt and dt.tzinfo is None:
            return dt.replace(tzinfo=UTC)
        return dt

    def setup_schedule(self):
        """Initial schedule setup from database."""
        self.sync_schedules()

    def sync_schedules(self):
        """
        Synchronize schedules from database.

        This method validates that schedules exist and are properly configured.
        """
        with Session(engine) as session:
            # Count enabled schedules for monitoring
            enabled_count = (
                session.scalar(
                    select(func.count(WorkflowSchedulePlan.id)).where(
                        WorkflowSchedulePlan.enabled == True,
                        WorkflowSchedulePlan.next_run_at.isnot(None),
                    )
                )
                or 0
            )

            logger.debug("Found %d enabled schedules", enabled_count)

        self._last_sync = time.monotonic()

    def tick(self):
        """
        Main scheduler tick - called periodically by Celery Beat.

        This method:
        1. Syncs with database if needed
        2. Finds and dispatches due schedules
        3. Uses SELECT FOR UPDATE SKIP LOCKED for HA

        Returns:
            Seconds until next tick
        """
        if self._last_sync is None or (time.monotonic() - self._last_sync) > self.sync_every:
            logger.debug("Syncing schedules with database")
            self.sync_schedules()

        now = datetime.now(UTC)

        with Session(engine) as session:
            # SKIP LOCKED ensures only one Beat instance processes each schedule in HA setup
            due_schedules = session.scalars(
                select(WorkflowSchedulePlan)
                .where(
                    WorkflowSchedulePlan.enabled == True,
                    WorkflowSchedulePlan.next_run_at <= now,
                    WorkflowSchedulePlan.next_run_at.isnot(None),
                )
                .with_for_update(skip_locked=True)
                .limit(self.batch_size)  # Limit to prevent memory issues
            ).all()

            if due_schedules:
                logger.info("Processing %d due schedules", len(due_schedules))

            schedules_to_update = []
            schedules_to_disable = []

            for schedule in due_schedules:
                try:
                    skip_execution = False
                    if schedule.next_run_at:
                        next_run_at = self.ensure_utc(schedule.next_run_at)
                        time_since_due = (now - next_run_at).total_seconds()

                        if time_since_due > self.misfire_grace_time:
                            logger.warning(
                                "Schedule %s misfired (due %.1fs ago) - skipping execution",
                                schedule.id,
                                time_since_due,
                            )
                            skip_execution = True

                    if not skip_execution:
                        result = run_schedule_trigger.delay(schedule.id)
                        logger.info("Dispatched schedule %s, task ID: %s", schedule.id, result.id)

                    # Calculate next run immediately to prevent duplicate triggers
                    next_run_at = ScheduleService.calculate_next_run_at(
                        schedule.cron_expression,
                        schedule.timezone,
                        base_time=now,
                    )

                    if next_run_at is None:
                        schedules_to_disable.append(schedule.id)
                        logger.info("Schedule %s has no more runs, will disable", schedule.id)
                    else:
                        schedules_to_update.append((schedule.id, next_run_at))
                        logger.debug("Schedule %s next run at %s", schedule.id, next_run_at)

                except Exception as e:
                    logger.error("Error processing schedule %s: %s", schedule.id, e, exc_info=True)

            # Bulk update to reduce database round trips from N to 1
            try:
                if schedules_to_update:
                    from sqlalchemy import case

                    stmt = (
                        sa.update(WorkflowSchedulePlan)
                        .where(WorkflowSchedulePlan.id.in_([s[0] for s in schedules_to_update]))
                        .values(next_run_at=case(dict(schedules_to_update), value=WorkflowSchedulePlan.id))
                    )
                    session.execute(stmt)

                if schedules_to_disable:
                    stmt = (
                        sa.update(WorkflowSchedulePlan)
                        .where(WorkflowSchedulePlan.id.in_(schedules_to_disable))
                        .values(enabled=False, next_run_at=None)
                    )
                    session.execute(stmt)

                session.commit()

                if schedules_to_update or schedules_to_disable:
                    logger.info(
                        "Bulk updated %d schedules, disabled %d",
                        len(schedules_to_update),
                        len(schedules_to_disable),
                    )

            except Exception as e:
                logger.error("Error bulk updating schedules: %s", e, exc_info=True)
                session.rollback()

            next_schedule = session.scalar(
                select(func.min(WorkflowSchedulePlan.next_run_at)).where(
                    WorkflowSchedulePlan.enabled == True,
                    WorkflowSchedulePlan.next_run_at > now,
                )
            )

        if next_schedule:
            next_schedule = self.ensure_utc(next_schedule)
            seconds_until_next = (next_schedule - now).total_seconds()
            # Cap to avoid too frequent checks or missing schedules
            return max(self.min_tick_interval, min(seconds_until_next, self.max_tick_interval))

        return self.max_tick_interval

    @property
    def info(self):
        """Return scheduler info for debugging."""
        with Session(engine) as session:
            schedule_count = (
                session.scalar(
                    select(func.count(WorkflowSchedulePlan.id)).where(
                        WorkflowSchedulePlan.enabled == True,
                        WorkflowSchedulePlan.next_run_at.isnot(None),
                    )
                )
                or 0
            )

        return {
            "scheduler": "WorkflowScheduler",
            "last_sync": self._last_sync if self._last_sync else None,
            "enabled_schedules": schedule_count,
            "config": {
                "sync_every": self.sync_every,
                "misfire_grace_time": self.misfire_grace_time,
                "min_tick_interval": self.min_tick_interval,
                "max_tick_interval": self.max_tick_interval,
            },
        }
