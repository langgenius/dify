import asyncio
from collections.abc import AsyncIterator
from typing import Any

import pytest
from pydantic_ai.messages import AgentStreamEvent, PartDeltaEvent, PartEndEvent, TextPart, TextPartDelta

from dify_agent.runtime.event_coalescer import coalesce_agent_stream_events


def _delta(content: str, *, index: int = 0, provider_details: dict[str, Any] | None = None) -> PartDeltaEvent:
    return PartDeltaEvent(
        index=index,
        delta=TextPartDelta(content, provider_name="test", provider_details=provider_details),
    )


def _part_end(content: str = "done") -> PartEndEvent:
    return PartEndEvent(index=0, part=TextPart(content))


async def _events(*events: PartDeltaEvent | PartEndEvent) -> AsyncIterator[PartDeltaEvent | PartEndEvent]:
    for event in events:
        yield event


async def _collect(events: AsyncIterator[AgentStreamEvent]) -> list[AgentStreamEvent]:
    return [event async for event in events]


def _delta_content(event: AgentStreamEvent) -> str:
    assert isinstance(event, PartDeltaEvent)
    assert isinstance(event.delta, TextPartDelta)
    return event.delta.content_delta


def test_coalesces_compatible_text_deltas_and_preserves_non_text_order() -> None:
    async def scenario() -> list[AgentStreamEvent]:
        return await _collect(
            coalesce_agent_stream_events(
                _events(_delta("hel"), _delta("lo"), _part_end()),
                flush_interval_seconds=10,
                max_chars=100,
            )
        )

    result = asyncio.run(scenario())

    assert len(result) == 2
    assert isinstance(result[0], PartDeltaEvent)
    assert isinstance(result[0].delta, TextPartDelta)
    assert result[0].delta.content_delta == "hello"
    assert isinstance(result[1], PartEndEvent)


def test_does_not_merge_different_parts_or_provider_details() -> None:
    async def scenario() -> list[AgentStreamEvent]:
        return await _collect(
            coalesce_agent_stream_events(
                _events(
                    _delta("a", index=0),
                    _delta("b", index=1),
                    _delta("c", index=1, provider_details={"token": 1}),
                ),
                flush_interval_seconds=10,
                max_chars=100,
            )
        )

    result = asyncio.run(scenario())

    assert [_delta_content(event) for event in result] == ["a", "b", "c"]


def test_flushes_when_character_limit_is_reached() -> None:
    async def scenario() -> list[AgentStreamEvent]:
        return await _collect(
            coalesce_agent_stream_events(
                _events(_delta("ab"), _delta("cd"), _delta("ef")),
                flush_interval_seconds=10,
                max_chars=4,
            )
        )

    result = asyncio.run(scenario())

    assert [_delta_content(event) for event in result] == ["abcd", "ef"]


def test_high_volume_text_deltas_are_reduced_to_size_bounded_batches() -> None:
    async def scenario() -> list[AgentStreamEvent]:
        async def many_deltas() -> AsyncIterator[AgentStreamEvent]:
            for _ in range(20_000):
                yield _delta("x")

        return await _collect(
            coalesce_agent_stream_events(
                many_deltas(),
                flush_interval_seconds=10,
                max_chars=4096,
            )
        )

    result = asyncio.run(scenario())

    assert len(result) == 5
    assert sum(len(_delta_content(event)) for event in result) == 20_000


def test_flushes_on_deadline_while_source_is_idle() -> None:
    async def scenario() -> tuple[PartDeltaEvent, PartEndEvent]:
        release_source = asyncio.Event()

        async def delayed_events() -> AsyncIterator[PartDeltaEvent | PartEndEvent]:
            yield _delta("ready")
            await release_source.wait()
            yield _part_end()

        events = coalesce_agent_stream_events(
            delayed_events(),
            flush_interval_seconds=0.01,
            max_chars=100,
        )
        first = await asyncio.wait_for(anext(events), timeout=0.2)
        release_source.set()
        second = await asyncio.wait_for(anext(events), timeout=0.2)
        with pytest.raises(StopAsyncIteration):
            _ = await anext(events)
        assert isinstance(first, PartDeltaEvent)
        assert isinstance(second, PartEndEvent)
        return first, second

    first, second = asyncio.run(scenario())

    assert isinstance(first.delta, TextPartDelta)
    assert first.delta.content_delta == "ready"
    assert isinstance(second.part, TextPart)
    assert second.part.content == "done"


def test_flushes_buffer_before_propagating_source_failure() -> None:
    async def scenario() -> PartDeltaEvent:
        async def failing_events() -> AsyncIterator[AgentStreamEvent]:
            yield _delta("partial")
            raise RuntimeError("stream failed")

        events = coalesce_agent_stream_events(
            failing_events(),
            flush_interval_seconds=10,
            max_chars=100,
        )
        first = await anext(events)
        with pytest.raises(RuntimeError, match="stream failed"):
            _ = await anext(events)
        assert isinstance(first, PartDeltaEvent)
        return first

    first = asyncio.run(scenario())

    assert isinstance(first.delta, TextPartDelta)
    assert first.delta.content_delta == "partial"


def test_flushes_buffer_before_consumer_cancellation() -> None:
    async def scenario() -> list[AgentStreamEvent]:
        source_waiting = asyncio.Event()
        emitted: list[AgentStreamEvent] = []

        async def blocked_events() -> AsyncIterator[AgentStreamEvent]:
            yield _delta("partial")
            source_waiting.set()
            await asyncio.Event().wait()

        async def consume() -> None:
            async for event in coalesce_agent_stream_events(
                blocked_events(),
                flush_interval_seconds=10,
                max_chars=100,
            ):
                emitted.append(event)

        task = asyncio.create_task(consume())
        await asyncio.wait_for(source_waiting.wait(), timeout=0.2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return emitted

    emitted = asyncio.run(scenario())

    assert len(emitted) == 1
    assert _delta_content(emitted[0]) == "partial"


@pytest.mark.parametrize(
    ("flush_interval_seconds", "max_chars", "message"),
    [(-0.1, 100, "non-negative"), (0.1, 0, "positive")],
)
def test_rejects_invalid_bounds(flush_interval_seconds: float, max_chars: int, message: str) -> None:
    async def scenario() -> None:
        events = coalesce_agent_stream_events(
            _events(_delta("a")),
            flush_interval_seconds=flush_interval_seconds,
            max_chars=max_chars,
        )
        with pytest.raises(ValueError, match=message):
            _ = await anext(events)

    asyncio.run(scenario())
