"""Contracts for trigger debug event and schedule runtime storage."""

from datetime import datetime
from typing import Protocol

from pydantic import BaseModel

from services.trigger.debug_events import BaseDebugEvent


class ScheduleDebugRuntime(BaseModel):
    cache_key: str
    timezone: str
    cron_expression: str
    next_run_at: datetime


class TriggerDebugEventStore(Protocol):
    def dispatch(self, tenant_id: str, event: BaseDebugEvent, pool_key: str) -> int: ...

    def poll[T: BaseDebugEvent](
        self, event_type: type[T], pool_key: str, tenant_id: str, user_id: str, app_id: str, node_id: str
    ) -> T | None: ...


class ScheduleDebugRuntimeStore(Protocol):
    def get_runtime(self, cache_key: str) -> ScheduleDebugRuntime | None: ...
    def save_runtime(self, runtime: ScheduleDebugRuntime) -> None: ...
    def delete_runtime(self, cache_key: str) -> None: ...
