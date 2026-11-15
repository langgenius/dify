"""Server-sent event formatting for run event replay.

SSE frames use the run event id as ``id`` and the run event type as ``event`` so
browsers can resume with ``Last-Event-ID`` while clients can subscribe by event
name. Payload data is the full public ``RunEvent`` JSON object.
"""

import asyncio
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


async def sse_event_stream(
    events: AsyncIterable[RunEvent],
    *,
    heartbeat_interval_seconds: float = 15.0,
) -> AsyncIterator[str]:
    """Yield events and keep idle SSE connections observable to clients."""
    if heartbeat_interval_seconds <= 0:
        raise ValueError("heartbeat_interval_seconds must be positive")

    iterator = events.__aiter__()
    next_event = asyncio.ensure_future(anext(iterator))
    try:
        while True:
            done, _ = await asyncio.wait({next_event}, timeout=heartbeat_interval_seconds)
            if not done:
                yield ": keepalive\n\n"
                continue
            try:
                event = next_event.result()
            except StopAsyncIteration:
                return
            yield format_sse_event(event)
            next_event = asyncio.ensure_future(anext(iterator))
    finally:
        if not next_event.done():
            _ = next_event.cancel()
            _ = await asyncio.gather(next_event, return_exceptions=True)


__all__ = ["format_sse_event", "sse_event_stream"]
