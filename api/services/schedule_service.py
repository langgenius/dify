import json
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.workflow.nodes import NodeType
from core.workflow.nodes.trigger_schedule.entities import ScheduleConfig, SchedulePlanUpdate
from core.workflow.nodes.trigger_schedule.exc import ScheduleConfigError, ScheduleNotFoundError
from libs.schedule_utils import calculate_next_run_at, convert_12h_to_24h
from models.account import Account, TenantAccountJoin
from models.workflow import Workflow, WorkflowSchedulePlan

logger = logging.getLogger(__name__)


class ScheduleService:
    @staticmethod
    def create_schedule(
        session: Session,
        tenant_id: str,
        app_id: str,
        config: ScheduleConfig,
    ) -> WorkflowSchedulePlan:
        """
        Create a new schedule with validated configuration.

        Args:
            session: Database session
            tenant_id: Tenant ID
            app_id: Application ID
            config: Validated schedule configuration

        Returns:
            Created WorkflowSchedulePlan instance
        """
        next_run_at = calculate_next_run_at(
            config.cron_expression,
            config.timezone,
        )

        schedule = WorkflowSchedulePlan(
            tenant_id=tenant_id,
            app_id=app_id,
            node_id=config.node_id,
            cron_expression=config.cron_expression,
            timezone=config.timezone,
            next_run_at=next_run_at,
        )

        session.add(schedule)
        session.flush()

        return schedule

    @staticmethod
    def update_schedule(
        session: Session,
        schedule_id: str,
        updates: SchedulePlanUpdate,
    ) -> Optional[WorkflowSchedulePlan]:
        """
        Update an existing schedule with validated configuration.

        Args:
            session: Database session
            schedule_id: Schedule ID to update
            updates: Validated update configuration

        Returns:
            Updated WorkflowSchedulePlan instance or None if not found
        """
        schedule = session.get(WorkflowSchedulePlan, schedule_id)
        if not schedule:
            raise ScheduleNotFoundError(f"Schedule not found: {schedule_id}")

        update_dict = updates.model_dump(exclude_none=True)
        for field, value in update_dict.items():
            if hasattr(schedule, field):
                setattr(schedule, field, value)

        # Ensure next_run_at stays accurate when schedule timing changes
        if "cron_expression" in update_dict or "timezone" in update_dict:
            next_run_at = calculate_next_run_at(
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
    ) -> None:
        """
        Delete a schedule plan.

        Args:
            session: Database session
            schedule_id: Schedule ID to delete
        """
        schedule = session.get(WorkflowSchedulePlan, schedule_id)
        if not schedule:
            raise ScheduleNotFoundError(f"Schedule not found: {schedule_id}")

        session.delete(schedule)
        session.flush()

    @staticmethod
    def get_tenant_owner(session: Session, tenant_id: str) -> Optional[Account]:
        """
        Returns an account to execute scheduled workflows on behalf of the tenant.
        Prioritizes owner over admin to ensure proper authorization hierarchy.
        """
        result = session.execute(
            select(TenantAccountJoin)
            .where(TenantAccountJoin.tenant_id == tenant_id, TenantAccountJoin.role == "owner")
            .limit(1)
        ).scalar_one_or_none()

        if not result:
            # Owner may not exist in some tenant configurations, fallback to admin
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
        Advances the schedule to its next execution time after a successful trigger.
        Uses current time as base to prevent missing executions during delays.
        """
        schedule = session.get(WorkflowSchedulePlan, schedule_id)
        if not schedule:
            raise ScheduleNotFoundError(f"Schedule not found: {schedule_id}")

        # Base on current time to handle execution delays gracefully
        next_run_at = calculate_next_run_at(
            schedule.cron_expression,
            schedule.timezone,
        )

        schedule.next_run_at = next_run_at
        session.flush()
        return next_run_at

    @staticmethod
    def extract_schedule_config(workflow: Workflow) -> Optional[ScheduleConfig]:
        """
        Extracts schedule configuration from workflow graph.

        Searches for the first schedule trigger node in the workflow and converts
        its configuration (either visual or cron mode) into a unified ScheduleConfig.

        Args:
            workflow: The workflow containing the graph definition

        Returns:
            ScheduleConfig if a valid schedule node is found, None otherwise

        Note:
            Currently only returns the first schedule node found.
            Multiple schedule nodes in the same workflow are not supported.
        """
        try:
            graph_data = workflow.graph_dict
        except (json.JSONDecodeError, TypeError, AttributeError):
            logger.exception("Failed to parse workflow graph")
            return None

        if not graph_data:
            return None

        nodes = graph_data.get("nodes", [])
        for node in nodes:
            node_data = node.get("data", {})

            if node_data.get("type") != NodeType.TRIGGER_SCHEDULE.value:
                continue

            mode = node_data.get("mode", "visual")
            timezone = node_data.get("timezone", "UTC")
            node_id = node.get("id", "start")

            cron_expression = None
            if mode == "cron":
                cron_expression = node_data.get("cron_expression")
            elif mode == "visual":
                cron_expression = ScheduleService.visual_to_cron(
                    node_data.get("frequency"), node_data.get("visual_config", {})
                )

            if cron_expression:
                return ScheduleConfig(node_id=node_id, cron_expression=cron_expression, timezone=timezone)
            else:
                raise ScheduleConfigError(f"Invalid schedule configuration: {node_data}")

        return None

    @staticmethod
    def visual_to_cron(frequency: str, visual_config: dict) -> Optional[str]:
        """
        Converts user-friendly visual schedule settings to cron expression.
        Maintains consistency with frontend UI expectations while supporting croniter's extended syntax.
        """
        if not frequency or not visual_config:
            return None

        try:
            if frequency == "hourly":
                on_minute = visual_config.get("on_minute", 0)
                return f"{on_minute} * * * *"

            elif frequency == "daily":
                time_str = visual_config.get("time", "12:00 PM")
                hour, minute = convert_12h_to_24h(time_str)
                return f"{minute} {hour} * * *"

            elif frequency == "weekly":
                time_str = visual_config.get("time", "12:00 PM")
                hour, minute = convert_12h_to_24h(time_str)

                weekdays = visual_config.get("weekdays", [])
                if not weekdays:
                    return None

                # Map to cron's 0-6 format where 0=Sunday for standard cron compatibility
                weekday_map = {"sun": "0", "mon": "1", "tue": "2", "wed": "3", "thu": "4", "fri": "5", "sat": "6"}
                cron_weekdays = []
                for day in weekdays:
                    if day in weekday_map:
                        cron_weekdays.append(weekday_map[day])

                if not cron_weekdays:
                    return None

                return f"{minute} {hour} * * {','.join(sorted(cron_weekdays))}"

            elif frequency == "monthly":
                time_str = visual_config.get("time", "12:00 PM")
                hour, minute = convert_12h_to_24h(time_str)

                monthly_days = visual_config.get("monthly_days", [])
                if not monthly_days:
                    return None

                cron_days = []
                for day in monthly_days:
                    if day == "last":
                        # croniter supports 'L' for last day of month, avoiding hardcoded day ranges
                        cron_days.append("L")
                    elif isinstance(day, int) and 1 <= day <= 31:
                        cron_days.append(str(day))

                if not cron_days:
                    return None

                # Keep 'L' at end for readability while sorting numeric days
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
