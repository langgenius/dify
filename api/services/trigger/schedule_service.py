import json
import logging
from collections.abc import Mapping
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.workflow.nodes import NodeType
from core.workflow.nodes.trigger_schedule.entities import ScheduleConfig, SchedulePlanUpdate, VisualConfig
from core.workflow.nodes.trigger_schedule.exc import ScheduleConfigError, ScheduleNotFoundError
from libs.schedule_utils import calculate_next_run_at, convert_12h_to_24h
from models.account import Account, TenantAccountJoin
from models.trigger import WorkflowSchedulePlan
from models.workflow import Workflow
from services.errors.account import AccountNotFoundError

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
    ) -> WorkflowSchedulePlan:
        """
        Update an existing schedule with validated configuration.

        Args:
            session: Database session
            schedule_id: Schedule ID to update
            updates: Validated update configuration

        Raises:
            ScheduleNotFoundError: If schedule not found

        Returns:
            Updated WorkflowSchedulePlan instance
        """
        schedule = session.get(WorkflowSchedulePlan, schedule_id)
        if not schedule:
            raise ScheduleNotFoundError(f"Schedule not found: {schedule_id}")

        # If time-related fields are updated, synchronously update the next_run_at.
        time_fields_updated = False

        if updates.node_id is not None:
            schedule.node_id = updates.node_id

        if updates.cron_expression is not None:
            schedule.cron_expression = updates.cron_expression
            time_fields_updated = True

        if updates.timezone is not None:
            schedule.timezone = updates.timezone
            time_fields_updated = True

        if time_fields_updated:
            schedule.next_run_at = calculate_next_run_at(
                schedule.cron_expression,
                schedule.timezone,
            )

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
    def get_tenant_owner(session: Session, tenant_id: str) -> Account:
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
            account = session.get(Account, result.account_id)
            if not account:
                raise AccountNotFoundError(f"Account not found: {result.account_id}")
            return account
        else:
            raise AccountNotFoundError(f"Account not found for tenant: {tenant_id}")

    @staticmethod
    def update_next_run_at(
        session: Session,
        schedule_id: str,
    ) -> datetime:
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
    def to_schedule_config(node_config: Mapping[str, Any]) -> ScheduleConfig:
        """
        Converts user-friendly visual schedule settings to cron expression.
        Maintains consistency with frontend UI expectations while supporting croniter's extended syntax.
        """
        node_data = node_config.get("data", {})
        mode = node_data.get("mode", "visual")
        timezone = node_data.get("timezone", "UTC")
        node_id = node_config.get("id", "start")

        cron_expression = None
        if mode == "cron":
            cron_expression = node_data.get("cron_expression")
            if not cron_expression:
                raise ScheduleConfigError("Cron expression is required for cron mode")
        elif mode == "visual":
            frequency = str(node_data.get("frequency"))
            if not frequency:
                raise ScheduleConfigError("Frequency is required for visual mode")
            visual_config = VisualConfig(**node_data.get("visual_config", {}))
            cron_expression = ScheduleService.visual_to_cron(frequency=frequency, visual_config=visual_config)
            if not cron_expression:
                raise ScheduleConfigError("Cron expression is required for visual mode")
        else:
            raise ScheduleConfigError(f"Invalid schedule mode: {mode}")
        return ScheduleConfig(node_id=node_id, cron_expression=cron_expression, timezone=timezone)

    @staticmethod
    def extract_schedule_config(workflow: Workflow) -> ScheduleConfig | None:
        """
        Extracts schedule configuration from workflow graph.

        Searches for the first schedule trigger node in the workflow and converts
        its configuration (either visual or cron mode) into a unified ScheduleConfig.

        Args:
            workflow: The workflow containing the graph definition

        Returns:
            ScheduleConfig if a valid schedule node is found, None if no schedule node exists

        Raises:
            ScheduleConfigError: If graph parsing fails or schedule configuration is invalid

        Note:
            Currently only returns the first schedule node found.
            Multiple schedule nodes in the same workflow are not supported.
        """
        try:
            graph_data = workflow.graph_dict
        except (json.JSONDecodeError, TypeError, AttributeError) as e:
            raise ScheduleConfigError(f"Failed to parse workflow graph: {e}")

        if not graph_data:
            raise ScheduleConfigError("Workflow graph is empty")

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
                if not cron_expression:
                    raise ScheduleConfigError("Cron expression is required for cron mode")
            elif mode == "visual":
                frequency = node_data.get("frequency")
                visual_config_dict = node_data.get("visual_config", {})
                visual_config = VisualConfig(**visual_config_dict)
                cron_expression = ScheduleService.visual_to_cron(frequency, visual_config)
            else:
                raise ScheduleConfigError(f"Invalid schedule mode: {mode}")

            return ScheduleConfig(node_id=node_id, cron_expression=cron_expression, timezone=timezone)

        return None

    @staticmethod
    def visual_to_cron(frequency: str, visual_config: VisualConfig) -> str:
        """
        Converts user-friendly visual schedule settings to cron expression.
        Maintains consistency with frontend UI expectations while supporting croniter's extended syntax.
        """
        if frequency == "hourly":
            if visual_config.on_minute is None:
                raise ScheduleConfigError("on_minute is required for hourly schedules")
            return f"{visual_config.on_minute} * * * *"

        elif frequency == "daily":
            if not visual_config.time:
                raise ScheduleConfigError("time is required for daily schedules")
            hour, minute = convert_12h_to_24h(visual_config.time)
            return f"{minute} {hour} * * *"

        elif frequency == "weekly":
            if not visual_config.time:
                raise ScheduleConfigError("time is required for weekly schedules")
            if not visual_config.weekdays:
                raise ScheduleConfigError("Weekdays are required for weekly schedules")
            hour, minute = convert_12h_to_24h(visual_config.time)
            weekday_map = {"sun": "0", "mon": "1", "tue": "2", "wed": "3", "thu": "4", "fri": "5", "sat": "6"}
            cron_weekdays = [weekday_map[day] for day in visual_config.weekdays]
            return f"{minute} {hour} * * {','.join(sorted(cron_weekdays))}"

        elif frequency == "monthly":
            if not visual_config.time:
                raise ScheduleConfigError("time is required for monthly schedules")
            if not visual_config.monthly_days:
                raise ScheduleConfigError("Monthly days are required for monthly schedules")
            hour, minute = convert_12h_to_24h(visual_config.time)

            numeric_days: list[int] = []
            has_last = False
            for day in visual_config.monthly_days:
                if day == "last":
                    has_last = True
                else:
                    numeric_days.append(day)

            result_days = [str(d) for d in sorted(set(numeric_days))]
            if has_last:
                result_days.append("L")

            return f"{minute} {hour} {','.join(result_days)} * *"

        else:
            raise ScheduleConfigError(f"Unsupported frequency: {frequency}")
