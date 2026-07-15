"""Server-sent event formatting for run event replay.

SSE frames use the run event id as ``id`` and the run event type as ``event`` so
browsers can resume with ``Last-Event-ID`` while clients can subscribe by event
name. Payload data is the full public ``RunEvent`` JSON object.
"""

from collections.abc import AsyncIterable, AsyncIterator

from dify_agent.protocol.schemas import RUN_EVENT_ADAPTER, RunEvent

_SSE_UNSAFE_LINE_SEPARATORS = str.maketrans(
    {
        "\x85": "\\u0085",
        "\u2028": "\\u2028",
        "\u2029": "\\u2029",
    }
)


def format_sse_event(event: RunEvent) -> str:
    """Serialize one event as an SSE frame."""
    lines: list[str] = []
    if event.id is not None:
        lines.append(f"id: {event.id}")
    lines.append(f"event: {event.type}")
    payload = RUN_EVENT_ADAPTER.dump_json(event).decode().translate(_SSE_UNSAFE_LINE_SEPARATORS)
    lines.append(f"data: {payload}")
    return "\n".join(lines) + "\n\n"


async def sse_event_stream(events: AsyncIterable[RunEvent]) -> AsyncIterator[str]:
    """Yield formatted SSE frames from public run events."""
    async for event in events:
        yield format_sse_event(event)


__all__ = ["format_sse_event", "sse_event_stream"]
