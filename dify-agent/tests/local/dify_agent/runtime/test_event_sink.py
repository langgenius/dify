import asyncio

import pytest

from agenton.compositor import CompositorSessionSnapshot
from dify_agent.protocol.schemas import (
    RunFailedEvent,
    RunFailedEventData,
    RunStartedEvent,
    RunSucceededEvent,
    RunSucceededEventData,
)
from dify_agent.runtime.event_sink import InMemoryRunEventSink, RunEventStreamSealedError, TerminalRunEvent


def _terminal_event(event_type: str, run_id: str) -> TerminalRunEvent:
    if event_type == "run_succeeded":
        return RunSucceededEvent(
            run_id=run_id,
            data=RunSucceededEventData(
                output="done",
                session_snapshot=CompositorSessionSnapshot(layers=[]),
            ),
        )
    if event_type == "run_failed":
        return RunFailedEvent(run_id=run_id, data=RunFailedEventData(error="model failed"))
    raise AssertionError(f"unexpected terminal event type: {event_type}")


@pytest.mark.parametrize(
    ("terminal_type", "terminal_status"),
    [
        ("run_succeeded", "succeeded"),
        ("run_failed", "failed"),
    ],
)
def test_terminal_event_seals_in_memory_stream(terminal_type: str, terminal_status: str) -> None:
    async def scenario() -> tuple[InMemoryRunEventSink, RunEventStreamSealedError]:
        sink = InMemoryRunEventSink()
        run_id = "run-1"
        _ = await sink.append_event(RunStartedEvent(run_id=run_id))
        _ = await sink.finalize_run(_terminal_event(terminal_type, run_id))

        with pytest.raises(RunEventStreamSealedError) as captured:
            _ = await sink.append_event(RunStartedEvent(run_id=run_id))
        return sink, captured.value

    sink, error = asyncio.run(scenario())

    assert error.run_id == "run-1"
    assert error.status == terminal_status
    assert [event.type for event in sink.events["run-1"]] == ["run_started", terminal_type]
