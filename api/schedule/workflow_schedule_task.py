import logging
from datetime import UTC, datetime

from celery import shared_task
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from extensions.ext_database import db
from models.workflow import WorkflowSchedulePlan
from services.workflow.schedule_manager import ScheduleService
from tasks.workflow_schedule_tasks import run_schedule_trigger

logger = logging.getLogger(__name__)


@shared_task(queue="schedule")
def poll_workflow_schedules():
    """
    Poll for due workflow schedules and dispatch them for execution.
    
    This task runs every minute via beat_schedule to check for schedules 
    that need to be triggered.
    """
    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
    
    with session_factory() as session:
        now = datetime.now(UTC)
        
        # Find all due schedules with FOR UPDATE SKIP LOCKED for HA support
        due_schedules = session.scalars(
            select(WorkflowSchedulePlan)
            .where(
                WorkflowSchedulePlan.enabled == True,
                WorkflowSchedulePlan.next_run_at <= now,
                WorkflowSchedulePlan.next_run_at.isnot(None),
            )
            .with_for_update(skip_locked=True)
            .limit(dify_config.WORKFLOW_SCHEDULE_POLLER_BATCH_SIZE)
        ).all()
        
        if due_schedules:
            logger.info("Processing %d due schedules", len(due_schedules))
        
        schedules_to_update = []
        schedules_to_disable = []
        
        for schedule in due_schedules:
            try:
                result = run_schedule_trigger.delay(schedule.id)
                logger.info("Dispatched schedule %s, task ID: %s", schedule.id, result.id)
                
                next_run_at = ScheduleService.calculate_next_run_at(
                    schedule.cron_expression,
                    schedule.timezone,
                    base_time=now,
                )
                
                if next_run_at is None:
                    schedule.enabled = False
                    schedule.next_run_at = None
                    schedules_to_disable.append(schedule.id)
                    logger.info("Schedule %s has no more runs, disabling", schedule.id)
                else:
                    # Update next run time
                    schedule.next_run_at = next_run_at
                    schedules_to_update.append(schedule.id)
                    logger.debug("Schedule %s next run at %s", schedule.id, next_run_at)
                    
            except Exception as e:
                logger.error("Error processing schedule %s: %s", schedule.id, e, exc_info=True)
        
        if schedules_to_update or schedules_to_disable:
            try:
                session.commit()
                logger.info(
                    "Updated %d schedules, disabled %d",
                    len(schedules_to_update),
                    len(schedules_to_disable),
                )
            except Exception as e:
                logger.error("Error committing schedule updates: %s", e, exc_info=True)
                session.rollback()