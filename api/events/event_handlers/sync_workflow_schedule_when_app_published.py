import json
import logging
from typing import Optional, cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.workflow.nodes import NodeType
from events.app_event import app_published_workflow_was_updated
from extensions.ext_database import db
from models import AppMode, Workflow, WorkflowSchedulePlan
from services.schedule_service import ScheduleService

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

    # Sync schedule configuration
    sync_schedule_from_workflow(tenant_id=app.tenant_id, app_id=app.id, workflow=published_workflow)


def sync_schedule_from_workflow(tenant_id: str, app_id: str, workflow: Workflow) -> Optional[WorkflowSchedulePlan]:
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
        # Extract schedule configuration from workflow
        schedule_config = extract_schedule_config(workflow)

        # Get existing schedule plan for this app
        existing_plan = session.scalar(
            select(WorkflowSchedulePlan).where(
                WorkflowSchedulePlan.tenant_id == tenant_id,
                WorkflowSchedulePlan.app_id == app_id,
            )
        )

        # If no schedule node exists, remove any existing plan
        if not schedule_config:
            if existing_plan:
                logger.info("No schedule node in workflow for app %s, removing schedule plan", app_id)
                session.delete(existing_plan)
                session.commit()
            return None

        # Extract schedule parameters
        node_id = schedule_config["node_id"]
        cron_expression = schedule_config["cron_expression"]
        timezone = schedule_config["timezone"]

        # Update existing plan or create new one
        if existing_plan:
            # Update existing schedule with new configuration
            logger.info("Updating schedule plan for app %s", app_id)
            updates = {
                "node_id": node_id,
                "cron_expression": cron_expression,
                "timezone": timezone,
            }
            updated_plan = ScheduleService.update_schedule(
                session=session,
                schedule_id=existing_plan.id,
                updates=updates,
            )
            session.commit()
            return updated_plan
        else:
            # Create new schedule
            logger.info("Creating new schedule plan for app %s", app_id)
            new_plan = ScheduleService.create_schedule(
                session=session,
                tenant_id=tenant_id,
                app_id=app_id,
                node_id=node_id,
                cron_expression=cron_expression,
                timezone=timezone,
            )
            session.commit()
            return new_plan


def extract_schedule_config(workflow: Workflow) -> Optional[dict]:
    """
    Extract schedule configuration from workflow graph.

    Args:
        workflow: Workflow instance

    Returns:
        Schedule configuration dict or None if no schedule node found
    """
    try:
        graph_data = workflow.graph_dict
    except (json.JSONDecodeError, TypeError, AttributeError):
        return None

    if not graph_data:
        return None

    # Find schedule trigger node in graph
    for node in graph_data.get("nodes", []):
        node_data = node.get("data", {})
        if node_data.get("type") == NodeType.TRIGGER_SCHEDULE.value:
            # Extract configuration
            mode = node_data.get("mode", "visual")
            timezone = node_data.get("timezone", "UTC")
            node_id = node.get("id", "start")

            # Convert to cron expression
            cron_expression = None
            if mode == "cron":
                cron_expression = node_data.get("cron_expression")
            elif mode == "visual":
                cron_expression = _visual_to_cron(node_data.get("frequency"), node_data.get("visual_config", {}))

            if cron_expression:
                return {
                    "node_id": node_id,
                    "cron_expression": cron_expression,
                    "timezone": timezone,
                }
            else:
                logger.warning("Invalid schedule configuration in node %s", node_id)
                return None

    return None


def _visual_to_cron(frequency: str, visual_config: dict) -> Optional[str]:
    """
    Convert visual schedule configuration to cron expression.

    Args:
        frequency: Schedule frequency (hourly, daily, weekly, monthly)
        visual_config: Visual configuration with time, weekdays, etc.

    Returns:
        Cron expression string or None if invalid
    """
    if not frequency or not visual_config:
        return None

    try:
        if frequency == "hourly":
            # Run at specific minute of every hour
            on_minute = visual_config.get("on_minute", 0)
            return f"{on_minute} * * * *"

        elif frequency == "daily":
            # Run daily at specific time
            time_str = visual_config.get("time", "12:00 PM")
            hour, minute = _parse_time(time_str)
            if hour is None or minute is None:
                return None
            return f"{minute} {hour} * * *"

        elif frequency == "weekly":
            # Run weekly on specific days at specific time
            time_str = visual_config.get("time", "12:00 PM")
            hour, minute = _parse_time(time_str)
            if hour is None or minute is None:
                return None

            weekdays = visual_config.get("weekdays", [])
            if not weekdays:
                return None

            # Convert weekday names to cron format (0-6, where 0=Sunday)
            weekday_map = {"sun": "0", "mon": "1", "tue": "2", "wed": "3", "thu": "4", "fri": "5", "sat": "6"}
            cron_weekdays = []
            for day in weekdays:
                if day in weekday_map:
                    cron_weekdays.append(weekday_map[day])

            if not cron_weekdays:
                return None

            return f"{minute} {hour} * * {','.join(sorted(cron_weekdays))}"

        elif frequency == "monthly":
            # Run monthly on specific days at specific time
            time_str = visual_config.get("time", "12:00 PM")
            hour, minute = _parse_time(time_str)
            if hour is None or minute is None:
                return None

            monthly_days = visual_config.get("monthly_days", [])
            if not monthly_days:
                return None

            # Convert monthly days to cron format
            cron_days = []
            for day in monthly_days:
                if day == "last":
                    # Last day of month - use 28-31 as approximation
                    cron_days.extend(["28", "29", "30", "31"])
                elif isinstance(day, int) and 1 <= day <= 31:
                    cron_days.append(str(day))

            if not cron_days:
                return None

            # Remove duplicates and sort
            cron_days = sorted(set(cron_days), key=int)
            return f"{minute} {hour} {','.join(cron_days)} * *"

        else:
            return None

    except Exception:
        return None


def _parse_time(time_str: str) -> tuple[Optional[int], Optional[int]]:
    """
    Parse time string in format "HH:MM AM/PM" to 24-hour format.

    Args:
        time_str: Time string like "11:30 AM" or "2:45 PM"

    Returns:
        Tuple of (hour, minute) in 24-hour format, or (None, None) if invalid
    """
    try:
        # Split time and period
        parts = time_str.strip().split()
        if len(parts) != 2:
            return None, None

        time_part, period = parts
        period = period.upper()

        if period not in ["AM", "PM"]:
            return None, None

        # Parse hour and minute
        time_parts = time_part.split(":")
        if len(time_parts) != 2:
            return None, None

        hour = int(time_parts[0])
        minute = int(time_parts[1])

        # Validate ranges
        if hour < 1 or hour > 12 or minute < 0 or minute > 59:
            return None, None

        # Convert to 24-hour format
        if period == "PM" and hour != 12:
            hour += 12
        elif period == "AM" and hour == 12:
            hour = 0

        return hour, minute

    except (ValueError, AttributeError):
        return None, None
