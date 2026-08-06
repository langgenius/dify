"""Event sink contracts used by the runner and storage adapters.

Non-terminal events remain append-only. Terminal events use ``finalize_run`` so
the event and matching run status are committed as one compare-and-set
transition. Tests can use ``InMemoryRunEventSink`` without Redis; production
storage implements the same contract with Redis streams in
``dify_agent.storage.redis_run_store``.
"""

from collections import defaultdict
from dataclasses import dataclass
from typing import Protocol, TypeAlias, cast

from pydantic import JsonValue
from pydantic_ai.messages import AgentStreamEvent

from agenton.compositor import CompositorSessionSnapshot
from dify_agent.protocol.schemas import (
    AgentRunUsage,
    DeferredToolCallPayload,
    EmptyRunEventData,
    PydanticAIStreamRunEvent,
    RunEvent,
    RunCancelledEvent,
    RunCancelledEventData,
    RunFailedEvent,
    RunFailedEventData,
    RunStartedEvent,
    RunStatus,
    RunSucceededEvent,
    RunSucceededEventData,
    utc_now,
)


_UNSET = object()
TerminalRunEvent: TypeAlias = RunSucceededEvent | RunFailedEvent | RunCancelledEvent
NonTerminalRunEvent: TypeAlias = RunStartedEvent | PydanticAIStreamRunEvent


@dataclass(frozen=True, slots=True)
class RunFinalizationResult:
    """Outcome of attempting the only terminal transition for one run."""

    applied: bool
    status: RunStatus
    event_id: str | None = None


class RunEventSink(Protocol):
    """Boundary used by runtime code to publish observable run progress."""

    async def append_event(self, event: NonTerminalRunEvent) -> str:
        """Persist a non-terminal event and return its cursor id."""
        ...

    async def finalize_run(self, event: TerminalRunEvent) -> RunFinalizationResult:
        """Atomically persist the first terminal event and matching status."""
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

    async def append_event(self, event: NonTerminalRunEvent) -> str:
        """Store a non-terminal event and assign a monotonic per-run cursor."""
        event_id = str(len(self.events[event.run_id]) + 1)
        stored = event.model_copy(update={"id": event_id})
        self.events[event.run_id].append(stored)
        return event_id

    async def finalize_run(self, event: TerminalRunEvent) -> RunFinalizationResult:
        """Store only the first terminal event and its derived status."""
        current_status = self.statuses.get(event.run_id, "running")
        if current_status != "running":
            return RunFinalizationResult(applied=False, status=current_status)

        status, error = terminal_event_status_and_error(event)
        event_id = str(len(self.events[event.run_id]) + 1)
        self.events[event.run_id].append(event.model_copy(update={"id": event_id}))
        self.statuses[event.run_id] = status
        self.errors[event.run_id] = error
        return RunFinalizationResult(applied=True, status=status, event_id=event_id)


def terminal_event_status_and_error(event: TerminalRunEvent) -> tuple[RunStatus, str | None]:
    """Derive the persisted terminal status fields from one typed event."""
    match event:
        case RunSucceededEvent():
            return "succeeded", None
        case RunFailedEvent():
            return "failed", event.data.error
        case RunCancelledEvent():
            return "cancelled", event.data.message or event.data.reason


async def emit_run_event(
    sink: RunEventSink,
    *,
    event: NonTerminalRunEvent,
) -> str:
    """Append an already typed non-terminal public run event."""
    return await sink.append_event(event)


async def emit_run_started(sink: RunEventSink, *, run_id: str) -> str:
    """Emit the first lifecycle event for one run."""
    return await emit_run_event(
        sink,
        event=RunStartedEvent(run_id=run_id, data=EmptyRunEventData(), created_at=utc_now()),
    )


async def emit_pydantic_ai_event(
    sink: RunEventSink,
    *,
    run_id: str,
    data: AgentStreamEvent,
    agent_message_delta: str | None = None,
) -> str:
    """Emit one typed Pydantic AI stream event."""
    return await emit_run_event(
        sink,
        event=PydanticAIStreamRunEvent(
            run_id=run_id,
            data=data,
            agent_message_delta=agent_message_delta,
            created_at=utc_now(),
        ),
    )


async def emit_run_succeeded(
    sink: RunEventSink,
    *,
    run_id: str,
    output: JsonValue | None | object = _UNSET,
    deferred_tool_call: DeferredToolCallPayload | object = _UNSET,
    session_snapshot: CompositorSessionSnapshot,
    usage: AgentRunUsage | None = None,
) -> RunFinalizationResult:
    """Finalize a run as succeeded with output or deferred continuation.

    Callers must activate exactly one result branch. ``_UNSET`` is used instead
    of ``None`` to preserve the distinction between an omitted inactive branch
    and an active ``output`` branch whose JSON value is explicitly ``null``.
    Without that sentinel, ``output=None`` would be indistinguishable from
    “output field absent”, which would break nullable-success payloads.
    """
    data: dict[str, JsonValue | DeferredToolCallPayload | CompositorSessionSnapshot | AgentRunUsage | None] = {
        "session_snapshot": session_snapshot,
    }
    if output is not _UNSET:
        data["output"] = cast(JsonValue | None, output)
    if deferred_tool_call is not _UNSET:
        data["deferred_tool_call"] = cast(DeferredToolCallPayload, deferred_tool_call)
    if usage is not None:
        data["usage"] = usage

    return await sink.finalize_run(
        RunSucceededEvent(
            run_id=run_id,
            data=RunSucceededEventData.model_validate(data),
            created_at=utc_now(),
        ),
    )


async def emit_run_failed(
    sink: RunEventSink,
    *,
    run_id: str,
    error: str,
    reason: str | None = None,
) -> RunFinalizationResult:
    """Finalize a run with a failed terminal event."""
    return await sink.finalize_run(
        RunFailedEvent(run_id=run_id, data=RunFailedEventData(error=error, reason=reason), created_at=utc_now()),
    )


async def emit_run_cancelled(
    sink: RunEventSink,
    *,
    run_id: str,
    reason: str | None = None,
    message: str | None = None,
) -> RunFinalizationResult:
    """Finalize a run with a cancelled terminal event."""
    return await sink.finalize_run(
        RunCancelledEvent(
            run_id=run_id,
            data=RunCancelledEventData(reason=reason, message=message),
            created_at=utc_now(),
        ),
    )


__all__ = [
    "InMemoryRunEventSink",
    "NonTerminalRunEvent",
    "RunEventSink",
    "RunFinalizationResult",
    "TerminalRunEvent",
    "emit_pydantic_ai_event",
    "emit_run_cancelled",
    "emit_run_event",
    "emit_run_failed",
    "emit_run_started",
    "emit_run_succeeded",
    "terminal_event_status_and_error",
]
