import json
import logging
from datetime import UTC, datetime
from typing import Optional

import pytz
from croniter import croniter
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.workflow.nodes import NodeType
from models.account import Account, TenantAccountJoin
from models.workflow import Workflow, WorkflowSchedulePlan

logger = logging.getLogger(__name__)


class ScheduleService:
    @staticmethod
    def calculate_next_run_at(
        cron_expression: str,
        timezone: str,
        base_time: Optional[datetime] = None,
    ) -> Optional[datetime]:
        try:
            tz = pytz.timezone(timezone)
            if base_time is None:
                base_time = datetime.now(UTC)
            base_time_tz = base_time.astimezone(tz)
            cron = croniter(cron_expression, base_time_tz)
            next_run_tz = cron.get_next(datetime)
            next_run_utc = next_run_tz.astimezone(UTC)
            return next_run_utc
        except Exception:
            logger.exception("Error calculating next run time")
            return None

    @staticmethod
    def create_schedule(
        session: Session,
        tenant_id: str,
        app_id: str,
        node_id: str,
        cron_expression: str,
        timezone: str,
    ) -> WorkflowSchedulePlan:
        """
        Create a new workflow schedule.

        Args:
            session: Database session
            tenant_id: Tenant ID
            app_id: Application ID
            node_id: Starting node ID
            cron_expression: Cron expression
            timezone: Timezone for cron evaluation

        Returns:
            Created WorkflowSchedulePlan instance
        """
        # Calculate initial next run time
        next_run_at = ScheduleService.calculate_next_run_at(
            cron_expression,
            timezone,
        )

        # Create schedule record
        schedule = WorkflowSchedulePlan(
            tenant_id=tenant_id,
            app_id=app_id,
            node_id=node_id,
            cron_expression=cron_expression,
            timezone=timezone,
            next_run_at=next_run_at,
        )

        session.add(schedule)
        session.flush()

        return schedule

    @staticmethod
    def update_schedule(
        session: Session,
        schedule_id: str,
        updates: dict,
    ) -> Optional[WorkflowSchedulePlan]:
        """
        Update a schedule with the provided changes.

        Args:
            session: Database session
            schedule_id: Schedule ID to update
            updates: Dictionary of fields to update

        Returns:
            Updated schedule or None if not found
        """
        schedule = session.get(WorkflowSchedulePlan, schedule_id)
        if not schedule:
            return None

        # Apply updates
        for field, value in updates.items():
            if hasattr(schedule, field):
                setattr(schedule, field, value)

        # Recalculate next_run_at if schedule parameters changed
        if any(field in updates for field in ["cron_expression", "timezone"]):
            next_run_at = ScheduleService.calculate_next_run_at(
                schedule.cron_expression,
                schedule.timezone,
            )
            schedule.next_run_at = next_run_at

        session.flush()
        return schedule

    @staticmethod
    def delete_schedule(
        session: Session,
        schedule_id: str,
    ) -> bool:
        """
        Delete a schedule.

        Args:
            session: Database session
            schedule_id: Schedule ID to delete

        Returns:
            True if deleted, False if not found
        """
        schedule = session.get(WorkflowSchedulePlan, schedule_id)
        if not schedule:
            return False

        session.delete(schedule)
        session.flush()
        return True

    @staticmethod
    def get_tenant_owner(session: Session, tenant_id: str) -> Optional[Account]:
        """
        Get the owner account for a tenant.
        Used to execute scheduled workflows on behalf of the tenant owner.

        Args:
            session: Database session
            tenant_id: Tenant ID

        Returns:
            Owner Account or None
        """
        # Query for owner role in tenant
        result = session.execute(
            select(TenantAccountJoin)
            .where(TenantAccountJoin.tenant_id == tenant_id, TenantAccountJoin.role == "owner")
            .limit(1)
        ).scalar_one_or_none()

        if not result:
            # Fallback to any admin if no owner
            result = session.execute(
                select(TenantAccountJoin)
                .where(TenantAccountJoin.tenant_id == tenant_id, TenantAccountJoin.role == "admin")
                .limit(1)
            ).scalar_one_or_none()

        if result:
            return session.get(Account, result.account_id)

        return None

    @staticmethod
    def update_next_run_at(
        session: Session,
        schedule_id: str,
    ) -> Optional[datetime]:
        """
        Calculate and update the next run time for a schedule.
        Used after a schedule has been triggered.

        Args:
            session: Database session
            schedule_id: Schedule ID

        Returns:
            New next_run_at datetime or None
        """
        schedule = session.get(WorkflowSchedulePlan, schedule_id)
        if not schedule:
            return None

        # Calculate next run time
        next_run_at = ScheduleService.calculate_next_run_at(
            schedule.cron_expression,
            schedule.timezone,
            base_time=datetime.now(UTC),  # Use current time as base
        )

        # Update schedule
        schedule.next_run_at = next_run_at
        session.flush()
        return next_run_at

    @staticmethod
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
                    cron_expression = ScheduleService.visual_to_cron(
                        node_data.get("frequency"), node_data.get("visual_config", {})
                    )

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

    @staticmethod
    def visual_to_cron(frequency: str, visual_config: dict) -> Optional[str]:
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
                hour, minute = ScheduleService.parse_time(time_str)
                if hour is None or minute is None:
                    return None
                return f"{minute} {hour} * * *"

            elif frequency == "weekly":
                # Run weekly on specific days at specific time
                time_str = visual_config.get("time", "12:00 PM")
                hour, minute = ScheduleService.parse_time(time_str)
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
                hour, minute = ScheduleService.parse_time(time_str)
                if hour is None or minute is None:
                    return None

                monthly_days = visual_config.get("monthly_days", [])
                if not monthly_days:
                    return None

                # Convert monthly days to cron format
                cron_days = []
                for day in monthly_days:
                    if day == "last":
                        # Use 'L' to represent the last day of month (supported by croniter)
                        cron_days.append("L")
                    elif isinstance(day, int) and 1 <= day <= 31:
                        cron_days.append(str(day))

                if not cron_days:
                    return None

                # Sort numeric days, but keep 'L' at the end if present
                numeric_days = [d for d in cron_days if d != "L"]
                has_last = "L" in cron_days

                sorted_days = []
                if numeric_days:
                    sorted_days = sorted(set(numeric_days), key=int)
                if has_last:
                    sorted_days.append("L")

                return f"{minute} {hour} {','.join(sorted_days)} * *"

            else:
                return None

        except Exception:
            return None

    @staticmethod
    def parse_time(time_str: str) -> tuple[Optional[int], Optional[int]]:
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
