"""Bound high-frequency text deltas before they reach the shared event sink."""

import asyncio
from collections.abc import AsyncIterable, AsyncIterator
from contextlib import suppress
from dataclasses import replace

from pydantic_ai.messages import AgentStreamEvent, PartDeltaEvent, TextPartDelta


DEFAULT_TEXT_DELTA_FLUSH_INTERVAL_SECONDS = 0.1
DEFAULT_TEXT_DELTA_MAX_CHARS = 4096


async def coalesce_agent_stream_events(
    events: AsyncIterable[AgentStreamEvent],
    *,
    enabled: bool = True,
    flush_interval_seconds: float = DEFAULT_TEXT_DELTA_FLUSH_INTERVAL_SECONDS,
    max_chars: int = DEFAULT_TEXT_DELTA_MAX_CHARS,
) -> AsyncIterator[AgentStreamEvent]:
    """Merge compatible text deltas with a soft debounce interval.

    One source event is read ahead while a text delta is buffered. Non-text events
    flush the buffer first, preserving the public Pydantic AI event ordering. The
    timer starts with the first buffered delta instead of sliding on every token.
    Already-ready source events may continue to merge after the interval; the
    interval triggers a flush once reading the next source event would block.
    """
    if flush_interval_seconds <= 0:
        raise ValueError("flush_interval_seconds must be positive")
    if max_chars <= 0:
        raise ValueError("max_chars must be positive")
    if not enabled:
        async for event in events:
            yield event
        return

    iterator = aiter(events)
    next_event_task: asyncio.Future[AgentStreamEvent] | None = asyncio.ensure_future(anext(iterator))
    buffered: PartDeltaEvent | None = None
    flush_deadline: float | None = None
    loop = asyncio.get_running_loop()

    try:
        while next_event_task is not None:
            timeout = None if flush_deadline is None else max(0.0, flush_deadline - loop.time())
            try:
                done, _pending = await asyncio.wait((next_event_task,), timeout=timeout)
            except asyncio.CancelledError:
                if buffered is not None:
                    yield buffered
                raise

            if not done:
                assert buffered is not None
                yield buffered
                buffered = None
                flush_deadline = None
                continue

            try:
                event = next_event_task.result()
            except StopAsyncIteration:
                next_event_task = None
                if buffered is not None:
                    yield buffered
                return
            except BaseException:
                next_event_task = None
                if buffered is not None:
                    yield buffered
                raise

            next_event_task = asyncio.ensure_future(anext(iterator))
            text_delta = _text_delta(event)
            if text_delta is None:
                if buffered is not None:
                    yield buffered
                    buffered = None
                    flush_deadline = None
                yield event
                continue

            if buffered is not None and _can_merge(buffered, event):
                buffered = _merge_text_deltas(buffered, event)
            else:
                if buffered is not None:
                    yield buffered
                assert isinstance(event, PartDeltaEvent)
                buffered = event
                flush_deadline = loop.time() + flush_interval_seconds

            buffered_delta = _text_delta(buffered)
            assert buffered_delta is not None
            if len(buffered_delta.content_delta) >= max_chars:
                yield buffered
                buffered = None
                flush_deadline = None
    finally:
        if next_event_task is not None and not next_event_task.done():
            next_event_task.cancel()
            with suppress(asyncio.CancelledError, StopAsyncIteration):
                _ = await next_event_task


def _text_delta(event: AgentStreamEvent) -> TextPartDelta | None:
    if isinstance(event, PartDeltaEvent) and isinstance(event.delta, TextPartDelta):
        return event.delta
    return None


def _can_merge(left: PartDeltaEvent, right: AgentStreamEvent) -> bool:
    right_delta = _text_delta(right)
    if right_delta is None:
        return False
    left_delta = left.delta
    assert isinstance(left_delta, TextPartDelta)
    assert isinstance(right, PartDeltaEvent)
    return (
        left.index == right.index
        and left_delta.provider_name == right_delta.provider_name
        and left_delta.provider_details == right_delta.provider_details
    )


def _merge_text_deltas(left: PartDeltaEvent, right: AgentStreamEvent) -> PartDeltaEvent:
    left_delta = left.delta
    right_delta = _text_delta(right)
    assert isinstance(left_delta, TextPartDelta)
    assert right_delta is not None
    merged_delta = replace(
        left_delta,
        content_delta=left_delta.content_delta + right_delta.content_delta,
    )
    return replace(left, delta=merged_delta)


__all__ = [
    "DEFAULT_TEXT_DELTA_FLUSH_INTERVAL_SECONDS",
    "DEFAULT_TEXT_DELTA_MAX_CHARS",
    "coalesce_agent_stream_events",
]
