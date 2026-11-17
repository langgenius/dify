"""Detached schedule values and transactional persistence contracts."""

from collections.abc import Mapping, Sequence
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from core.workflow.nodes.trigger_schedule.entities import ScheduleConfig


@dataclass(frozen=True, slots=True)
class TriggerSchedule:
    id: str
    tenant_id: str
    app_id: str
    node_id: str
    cron_expression: str
    timezone: str
    next_run_at: datetime | None


@dataclass(frozen=True, slots=True)
class ScheduleExecution:
    schedule: TriggerSchedule
    account_id: str


class SchedulePublicationWriter(Protocol):
    def __call__(
        self, *, tenant_id: str, app_id: str, config: ScheduleConfig | None, next_run_at: datetime | None
    ) -> None: ...


class ClaimedSchedules(Protocol):
    @property
    def schedules(self) -> Sequence[TriggerSchedule]: ...

    def advance(self, next_run_times: Mapping[str, datetime]) -> None: ...


class TriggerScheduleStore(Protocol):
    def claim_due(self, *, now: datetime, limit: int) -> AbstractContextManager[ClaimedSchedules]: ...

    def get_for_execution(self, schedule_id: str) -> ScheduleExecution: ...
