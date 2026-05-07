"""Event sink contracts used by the runner and storage adapters.

The runner only needs append-only event writes and status transitions, so tests
can use ``InMemoryRunEventSink`` without Redis. Production storage implements the
same protocol with Redis streams in ``dify_agent.storage.redis_run_store``.
"""

from collections import defaultdict
from typing import Protocol

from pydantic import JsonValue

from dify_agent.server.schemas import RunEvent, RunEventType, RunStatus, utc_now


class RunEventSink(Protocol):
    """Boundary used by runtime code to publish observable run progress."""

    async def append_event(self, event: RunEvent) -> str:
        """Persist ``event`` and return its cursor id."""
        ...

    async def update_status(self, run_id: str, status: RunStatus, error: str | None = None) -> None:
        """Persist the current run status."""
        ...


class InMemoryRunEventSink:
    """Small async-compatible sink for local unit tests and examples."""

    events: dict[str, list[RunEvent]]
    statuses: dict[str, RunStatus]
    errors: dict[str, str | None]

    def __init__(self) -> None:
        self.events = defaultdict(list)
        self.statuses = {}
        self.errors = {}

    async def append_event(self, event: RunEvent) -> str:
        """Store an event and assign a monotonic per-run cursor."""
        event_id = str(len(self.events[event.run_id]) + 1)
        stored = event.model_copy(update={"id": event_id})
        self.events[event.run_id].append(stored)
        return event_id

    async def update_status(self, run_id: str, status: RunStatus, error: str | None = None) -> None:
        """Record the latest status; timestamps are owned by run stores."""
        self.statuses[run_id] = status
        self.errors[run_id] = error


async def emit_run_event(
    sink: RunEventSink,
    *,
    run_id: str,
    type: RunEventType,
    data: JsonValue,
) -> str:
    """Create and append a timestamped ``RunEvent``."""
    return await sink.append_event(RunEvent(run_id=run_id, type=type, data=data, created_at=utc_now()))


__all__ = ["InMemoryRunEventSink", "RunEventSink", "emit_run_event"]
