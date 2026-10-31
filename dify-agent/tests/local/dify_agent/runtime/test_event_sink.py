"""Contract tests for the in-memory RunEventSink adapter."""

import pytest

from dify_agent.protocol.schemas import RunFailedEvent, RunFailedEventData, RunStartedEvent
from dify_agent.runtime.event_sink import InMemoryRunEventSink, RunStreamSealedError


@pytest.mark.anyio
async def test_append_event_after_terminal_finalization_is_rejected():
    sink = InMemoryRunEventSink()
    finalization = await sink.finalize_run(RunFailedEvent(run_id="run-1", data=RunFailedEventData(error="boom")))
    assert finalization.applied

    with pytest.raises(RunStreamSealedError) as sealed:
        await sink.append_event(RunStartedEvent(run_id="run-1"))

    assert sealed.value.run_id == "run-1"
    assert sealed.value.status == "failed"
    assert [type(event) for event in sink.events["run-1"]] == [RunFailedEvent]
