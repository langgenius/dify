"""Server-sent event formatting for run event replay.

SSE frames use the run event id as ``id`` and the run event type as ``event`` so
browsers can resume with ``Last-Event-ID`` while clients can subscribe by event
name. Payload data is the full public ``RunEvent`` JSON object.
"""

from collections.abc import AsyncIterable, AsyncIterator

from dify_agent.protocol.schemas import RUN_EVENT_ADAPTER, RunEvent


def format_sse_event(event: RunEvent) -> str:
    """Serialize one event as an SSE frame."""
    lines: list[str] = []
    if event.id is not None:
        lines.append(f"id: {event.id}")
    lines.append(f"event: {event.type}")
    lines.append(f"data: {RUN_EVENT_ADAPTER.dump_json(event).decode()}")
    return "\n".join(lines) + "\n\n"


async def sse_event_stream(events: AsyncIterable[RunEvent]) -> AsyncIterator[str]:
    """Yield formatted SSE frames from public run events."""
    async for event in events:
        yield format_sse_event(event)


__all__ = ["format_sse_event", "sse_event_stream"]
