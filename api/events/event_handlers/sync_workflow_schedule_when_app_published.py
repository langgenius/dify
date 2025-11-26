import logging
from typing import cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.workflow.nodes.trigger_schedule.entities import SchedulePlanUpdate
from events.app_event import app_published_workflow_was_updated
from extensions.ext_database import db
from models import AppMode, Workflow, WorkflowSchedulePlan
from services.trigger.schedule_service import ScheduleService

logger = logging.getLogger(__name__)


@app_published_workflow_was_updated.connect
def handle(sender, **kwargs):
    """
    Handle app published workflow update event to sync workflow_schedule_plans table.

    When a workflow is published, this handler will:
    1. Extract schedule trigger nodes from the workflow graph
    2. Compare with existing workflow_schedule_plans records
    3. Create/update/delete schedule plans as needed
    """
    app = sender
    if app.mode != AppMode.WORKFLOW.value:
        return

    published_workflow = kwargs.get("published_workflow")
    published_workflow = cast(Workflow, published_workflow)

    sync_schedule_from_workflow(tenant_id=app.tenant_id, app_id=app.id, workflow=published_workflow)


def sync_schedule_from_workflow(tenant_id: str, app_id: str, workflow: Workflow) -> WorkflowSchedulePlan | None:
    """
    Sync schedule plan from workflow graph configuration.

    Args:
        tenant_id: Tenant ID
        app_id: App ID
        workflow: Published workflow instance

    Returns:
        Updated or created WorkflowSchedulePlan, or None if no schedule node
    """
    with Session(db.engine) as session:
        schedule_config = ScheduleService.extract_schedule_config(workflow)

        existing_plan = session.scalar(
            select(WorkflowSchedulePlan).where(
                WorkflowSchedulePlan.tenant_id == tenant_id,
                WorkflowSchedulePlan.app_id == app_id,
            )
        )

        if not schedule_config:
            if existing_plan:
                logger.info("No schedule node in workflow for app %s, removing schedule plan", app_id)
                ScheduleService.delete_schedule(session=session, schedule_id=existing_plan.id)
                session.commit()
            return None

        if existing_plan:
            updates = SchedulePlanUpdate(
                node_id=schedule_config.node_id,
                cron_expression=schedule_config.cron_expression,
                timezone=schedule_config.timezone,
            )
            updated_plan = ScheduleService.update_schedule(
                session=session,
                schedule_id=existing_plan.id,
                updates=updates,
            )
            session.commit()
            return updated_plan
        else:
            new_plan = ScheduleService.create_schedule(
                session=session,
                tenant_id=tenant_id,
                app_id=app_id,
                config=schedule_config,
            )
            session.commit()
            return new_plan
