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
    1. Extract all schedule trigger nodes from the workflow graph
    2. Compare with existing workflow_schedule_plans records
    3. Create/update/delete schedule plans as needed
    """
    app = sender
    if app.mode != AppMode.WORKFLOW.value:
        return

    published_workflow = kwargs.get("published_workflow")
    published_workflow = cast(Workflow, published_workflow)

    sync_schedule_from_workflow(tenant_id=app.tenant_id, app_id=app.id, workflow=published_workflow)


def sync_schedule_from_workflow(tenant_id: str, app_id: str, workflow: Workflow) -> list[WorkflowSchedulePlan]:
    """
    Sync all schedule plans from workflow graph configuration.

    Args:
        tenant_id: Tenant ID
        app_id: App ID
        workflow: Published workflow instance

    Returns:
        List of updated or created WorkflowSchedulePlans
    """
    with Session(db.engine) as session:
        schedule_configs = ScheduleService.extract_all_schedule_configs(workflow)

        # Get all existing plans for this app
        existing_plans = (
            session.execute(
                select(WorkflowSchedulePlan).where(
                    WorkflowSchedulePlan.tenant_id == tenant_id,
                    WorkflowSchedulePlan.app_id == app_id,
                )
            )
            .scalars()
            .all()
        )

        # Convert existing plans to dict for easy lookup by node_id
        existing_plans_map = {plan.node_id: plan for plan in existing_plans}

        # Get current and new node IDs
        existing_node_ids = set(existing_plans_map.keys())
        new_node_ids = {config.node_id for config in schedule_configs}

        # Calculate changes
        added_node_ids = new_node_ids - existing_node_ids
        removed_node_ids = existing_node_ids - new_node_ids
        updated_node_ids = existing_node_ids & new_node_ids

        # Remove obsolete schedule plans
        for node_id in removed_node_ids:
            plan = existing_plans_map[node_id]
            logger.info("Removing obsolete schedule plan for app %s, node %s", app_id, node_id)
            ScheduleService.delete_schedule(session=session, schedule_id=plan.id)

        result_plans: list[WorkflowSchedulePlan] = []

        # Create or update schedule plans
        for config in schedule_configs:
            if config.node_id in added_node_ids:
                # Create new schedule plan
                new_plan = ScheduleService.create_schedule(
                    session=session,
                    tenant_id=tenant_id,
                    app_id=app_id,
                    config=config,
                )
                result_plans.append(new_plan)
                logger.info("Created schedule plan for app %s, node %s", app_id, config.node_id)
            elif config.node_id in updated_node_ids:
                # Update existing schedule plan only if config changed
                existing_plan = existing_plans_map[config.node_id]
                if existing_plan.cron_expression != config.cron_expression or existing_plan.timezone != config.timezone:
                    logger.info("Updating schedule plan for app %s, node %s", app_id, config.node_id)
                    updates = SchedulePlanUpdate(
                        node_id=config.node_id,
                        cron_expression=config.cron_expression,
                        timezone=config.timezone,
                    )
                    updated_plan = ScheduleService.update_schedule(
                        session=session,
                        schedule_id=existing_plan.id,
                        updates=updates,
                    )
                    result_plans.append(updated_plan)
                else:
                    result_plans.append(existing_plan)

        session.commit()
        return result_plans
