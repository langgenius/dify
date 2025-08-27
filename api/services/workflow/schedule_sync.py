import json
import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.workflow import WorkflowSchedulePlan
from services.workflow.schedule_manager import ScheduleService

logger = logging.getLogger(__name__)


class ScheduleSyncService:
    @staticmethod
    def sync_schedule_from_graph(
        session: Session,
        tenant_id: str,
        app_id: str,
        graph: str,
    ) -> Optional[WorkflowSchedulePlan]:
        try:
            graph_data = json.loads(graph)
        except (json.JSONDecodeError, TypeError):
            return None

        # Find schedule trigger node in graph
        schedule_node = None
        node_id = None
        schedule_nodes_count = 0

        for node in graph_data.get("nodes", []):
            node_data = node.get("data", {})
            if node_data.get("type") == "trigger-schedule":
                schedule_nodes_count += 1
                if not schedule_node:  # Take the first schedule node
                    schedule_node = node_data
                    node_id = node.get("id", "start")

        if schedule_nodes_count > 1:
            logger.warning("Found %d schedule nodes in workflow, only the first one will be used", schedule_nodes_count)

        # Get existing schedule plan for this app
        existing_plan = session.scalar(
            select(WorkflowSchedulePlan).where(
                WorkflowSchedulePlan.tenant_id == tenant_id,
                WorkflowSchedulePlan.app_id == app_id,
            )
        )

        # If no schedule node exists, disable the schedule but keep the plan
        if not schedule_node:
            if existing_plan:
                logger.info("No schedule node in workflow for app %s, disabling schedule plan", app_id)
                updates = {
                    "enabled": False,  # Disable but keep the plan
                    "next_run_at": None,  # Clear next run time
                }
                return ScheduleService.update_schedule(
                    session=session,
                    schedule_id=existing_plan.id,
                    updates=updates,
                )
            # No existing plan and no schedule node, nothing to do
            return None

        # Extract schedule configuration
        mode = schedule_node.get("mode", "visual")
        timezone = schedule_node.get("timezone", "UTC")
        enabled = schedule_node.get("enabled", True)

        # Convert to cron expression
        cron_expression = None
        if mode == "cron":
            cron_expression = schedule_node.get("cron_expression")
        elif mode == "visual":
            cron_expression = ScheduleSyncService._visual_to_cron(
                schedule_node.get("frequency"), schedule_node.get("visual_config", {})
            )

        if not cron_expression:
            # Invalid configuration, remove existing plan
            logger.warning("Invalid schedule configuration for app %s, removing schedule plan", app_id)
            if existing_plan:
                session.delete(existing_plan)
                session.flush()
            return None

        # Update existing plan or create new one
        if existing_plan:
            # Update existing schedule with new workflow version
            logger.info("Updating schedule plan for app %s with new workflow %s", app_id)
            updates = {
                "node_id": node_id,
                "cron_expression": cron_expression,
                "timezone": timezone,
                "enabled": enabled,
            }
            updated_plan = ScheduleService.update_schedule(
                session=session,
                schedule_id=existing_plan.id,
                updates=updates,
            )
            return updated_plan
        else:
            # Create new schedule
            logger.info("Creating new schedule plan for app %s, workflow %s", app_id)
            new_plan = ScheduleService.create_schedule(
                session=session,
                tenant_id=tenant_id,
                app_id=app_id,
                node_id=node_id,
                cron_expression=cron_expression,
                timezone=timezone,
                enabled=enabled,
                triggered_by="production",
            )
            return new_plan

    @staticmethod
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
                hour, minute = ScheduleSyncService._parse_time(time_str)
                if hour is None or minute is None:
                    return None
                return f"{minute} {hour} * * *"

            elif frequency == "weekly":
                # Run weekly on specific days at specific time
                time_str = visual_config.get("time", "12:00 PM")
                hour, minute = ScheduleSyncService._parse_time(time_str)
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
                hour, minute = ScheduleSyncService._parse_time(time_str)
                if hour is None or minute is None:
                    return None

                monthly_days = visual_config.get("monthly_days", [])
                if not monthly_days:
                    return None

                # Convert monthly days to cron format
                cron_days = []
                for day in monthly_days:
                    if day == "last":
                        # Last day of month (L is supported by some cron implementations)
                        # For standard cron, we use 28-31 as approximation
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

    @staticmethod
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
