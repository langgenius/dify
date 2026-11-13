"""Cron rules, publication synchronization, polling, and schedule execution."""

import logging
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime
from typing import Any, Protocol

from constants.trigger import TRIGGER_SCHEDULE_NODE_TYPE
from core.workflow.nodes.trigger_schedule.entities import ScheduleConfig, TriggerScheduleNodeData, VisualConfig
from core.workflow.nodes.trigger_schedule.exc import ScheduleConfigError, ScheduleExecutionError
from graphon.entities.graph_config import NodeConfigDict
from libs.schedule_utils import calculate_next_run_at, convert_12h_to_24h
from services.errors.app import QuotaExceededError
from services.trigger.schedule_store import SchedulePublicationWriter, TriggerScheduleStore

logger = logging.getLogger(__name__)


class ScheduleService:
    """Pure schedule configuration rules shared by publication and debug execution."""

    @staticmethod
    def to_schedule_config(node_config: NodeConfigDict) -> ScheduleConfig:
        """
        Converts user-friendly visual schedule settings to cron expression.
        Maintains consistency with frontend UI expectations while supporting croniter's extended syntax.
        """
        node_data = TriggerScheduleNodeData.model_validate(node_config["data"], from_attributes=True)
        mode = node_data.mode
        timezone = node_data.timezone
        node_id = node_config["id"]

        cron_expression = None
        if mode == "cron":
            cron_expression = node_data.cron_expression
            if not cron_expression:
                raise ScheduleConfigError("Cron expression is required for cron mode")
        elif mode == "visual":
            frequency = str(node_data.frequency or "")
            if not frequency:
                raise ScheduleConfigError("Frequency is required for visual mode")
            visual_config = VisualConfig.model_validate(node_data.visual_config or {})
            cron_expression = ScheduleService.visual_to_cron(frequency=frequency, visual_config=visual_config)
            if not cron_expression:
                raise ScheduleConfigError("Cron expression is required for visual mode")
        else:
            raise ScheduleConfigError(f"Invalid schedule mode: {mode}")
        return ScheduleConfig(node_id=node_id, cron_expression=cron_expression, timezone=timezone)

    @staticmethod
    def extract_schedule_config(graph_data: Mapping[str, Any]) -> ScheduleConfig | None:
        """
        Extracts schedule configuration from workflow graph.

        Searches for the first schedule trigger node in the workflow and converts
        its configuration (either visual or cron mode) into a unified ScheduleConfig.

        Args:
            graph_data: The detached workflow graph definition

        Returns:
            ScheduleConfig if a valid schedule node is found, None if no schedule node exists

        Raises:
            ScheduleConfigError: If graph parsing fails or schedule configuration is invalid

        Note:
            Currently only returns the first schedule node found.
            Multiple schedule nodes in the same workflow are not supported.
        """
        if not graph_data:
            raise ScheduleConfigError("Workflow graph is empty")

        nodes = graph_data.get("nodes", [])
        for node in nodes:
            node_data = node.get("data", {})

            if node_data.get("type") != TRIGGER_SCHEDULE_NODE_TYPE:
                continue

            return ScheduleService.to_schedule_config({"id": node.get("id", "start"), "data": node_data})

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


class SchedulePublicationService:
    def __init__(self, *, sync_schedule: SchedulePublicationWriter, now: Callable[[], datetime]) -> None:
        self._sync_schedule = sync_schedule
        self._now = now

    def sync(self, *, tenant_id: str, app_id: str, graph: Mapping[str, Any]) -> None:
        """Synchronize a published graph in the writer's transaction.

        Invalid schedule configuration raises before the writer is called; a graph
        without a schedule removes any existing plan.
        """
        config = ScheduleService.extract_schedule_config(graph)
        next_run_at = (
            calculate_next_run_at(config.cron_expression, config.timezone, self._now()) if config is not None else None
        )
        self._sync_schedule(tenant_id=tenant_id, app_id=app_id, config=config, next_run_at=next_run_at)


class ScheduleQuotaCharge(Protocol):
    def commit(self) -> None: ...
    def refund(self) -> None: ...


class ScheduleWorkflowDispatcher(Protocol):
    def __call__(self, *, account_id: str, tenant_id: str, app_id: str, node_id: str) -> str: ...


class TriggerScheduleService:
    def __init__(
        self,
        *,
        schedules: TriggerScheduleStore,
        publish: Callable[[Sequence[str]], None],
        dispatch: ScheduleWorkflowDispatcher,
        reserve: Callable[[str], ScheduleQuotaCharge],
        mark_rate_limited: Callable[[str], None],
        now: Callable[[], datetime],
        batch_size: int,
        max_dispatch_per_tick: int,
    ) -> None:
        self._schedules = schedules
        self._publish = publish
        self._dispatch = dispatch
        self._reserve = reserve
        self._mark_rate_limited = mark_rate_limited
        self._now = now
        self._batch_size = batch_size
        self._max_dispatch_per_tick = max_dispatch_per_tick

    def poll(self) -> int:
        """Claim due schedules, advance them, and return the number dispatched.

        Each batch is published before its claim transaction commits; publication
        failures propagate and roll back that batch's schedule updates.
        """
        total_dispatched = 0
        has_more = True
        while has_more:
            with self._schedules.claim_due(now=self._now(), limit=self._batch_size) as claimed:
                schedules = claimed.schedules
                if schedules:
                    next_run_times = {
                        schedule.id: calculate_next_run_at(schedule.cron_expression, schedule.timezone, self._now())
                        for schedule in schedules
                    }
                    claimed.advance(next_run_times)
                    self._publish(tuple(schedule.id for schedule in schedules))
            total_dispatched += len(schedules)
            limit_reached = 0 < self._max_dispatch_per_tick <= total_dispatched
            if limit_reached:
                logger.warning(
                    "Schedule dispatch limit reached after %d schedules; continuing next tick", total_dispatched
                )
            has_more = bool(schedules) and not limit_reached
        if total_dispatched:
            logger.info("Total processed: %d workflow schedule(s) dispatched", total_dispatched)
        return total_dispatched

    def execute(self, schedule_id: str) -> None:
        """Dispatch an existing schedule using its tenant owner or admin.

        Quota exhaustion marks the tenant rate-limited and skips dispatch. A
        successful dispatch commits the reservation. Dispatch or commit failure
        attempts a refund and raises ScheduleExecutionError if the refund succeeds.
        """
        execution = self._schedules.get_for_execution(schedule_id)
        schedule = execution.schedule
        try:
            charge = self._reserve(schedule.tenant_id)
        except QuotaExceededError:
            self._mark_rate_limited(schedule.tenant_id)
            logger.info("Tenant %s rate limited, skipping schedule trigger %s", schedule.tenant_id, schedule_id)
            return
        try:
            trigger_log_id = self._dispatch(
                account_id=execution.account_id,
                tenant_id=schedule.tenant_id,
                app_id=schedule.app_id,
                node_id=schedule.node_id,
            )
            charge.commit()
        except Exception as exc:
            charge.refund()
            raise ScheduleExecutionError(
                f"Failed to trigger workflow for schedule {schedule_id}, app {schedule.app_id}"
            ) from exc
        logger.info("Schedule %s triggered workflow: %s", schedule_id, trigger_log_id)
