"""Event sink contracts used by the runner and storage adapters.

The runner only needs append-only event writes and status transitions, so tests
can use ``InMemoryRunEventSink`` without Redis. Production storage implements the
same protocol with Redis streams in ``dify_agent.storage.redis_run_store``.
"""

from collections import defaultdict
from typing import Protocol

from pydantic_ai.messages import AgentStreamEvent

from agenton.compositor import CompositorSessionSnapshot
from dify_agent.server.schemas import (
    AgentOutputRunEvent,
    AgentOutputRunEventData,
    EmptyRunEventData,
    PydanticAIStreamRunEvent,
    RunEvent,
    RunFailedEvent,
    RunFailedEventData,
    RunStartedEvent,
    RunStatus,
    RunSucceededEvent,
    SessionSnapshotRunEvent,
    utc_now,
)


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
    event: RunEvent,
) -> str:
    """Append an already typed public run event."""
    return await sink.append_event(event)


async def emit_run_started(sink: RunEventSink, *, run_id: str) -> str:
    """Emit the first lifecycle event for one run."""
    return await emit_run_event(
        sink,
        event=RunStartedEvent(run_id=run_id, data=EmptyRunEventData(), created_at=utc_now()),
    )


async def emit_pydantic_ai_event(sink: RunEventSink, *, run_id: str, data: AgentStreamEvent) -> str:
    """Emit one typed Pydantic AI stream event."""
    return await emit_run_event(
        sink,
        event=PydanticAIStreamRunEvent(run_id=run_id, data=data, created_at=utc_now()),
    )


async def emit_agent_output(sink: RunEventSink, *, run_id: str, output: str) -> str:
    """Emit the final output text produced by the agent."""
    return await emit_run_event(
        sink,
        event=AgentOutputRunEvent(
            run_id=run_id,
            data=AgentOutputRunEventData(output=output),
            created_at=utc_now(),
        ),
    )


async def emit_session_snapshot(sink: RunEventSink, *, run_id: str, data: CompositorSessionSnapshot) -> str:
    """Emit the typed Agenton session snapshot for later resumption."""
    return await emit_run_event(
        sink,
        event=SessionSnapshotRunEvent(run_id=run_id, data=data, created_at=utc_now()),
    )


async def emit_run_succeeded(sink: RunEventSink, *, run_id: str) -> str:
    """Emit the terminal success lifecycle event."""
    return await emit_run_event(
        sink,
        event=RunSucceededEvent(run_id=run_id, data=EmptyRunEventData(), created_at=utc_now()),
    )


async def emit_run_failed(
    sink: RunEventSink,
    *,
    run_id: str,
    error: str,
    reason: str | None = None,
) -> str:
    """Emit the terminal failure lifecycle event."""
    return await emit_run_event(
        sink,
        event=RunFailedEvent(run_id=run_id, data=RunFailedEventData(error=error, reason=reason), created_at=utc_now()),
    )


__all__ = [
    "InMemoryRunEventSink",
    "RunEventSink",
    "emit_agent_output",
    "emit_pydantic_ai_event",
    "emit_run_event",
    "emit_run_failed",
    "emit_run_started",
    "emit_run_succeeded",
    "emit_session_snapshot",
]
