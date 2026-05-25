from dify_agent.protocol.schemas import RunStartedEvent
from dify_agent.server.sse import format_sse_event


def test_format_sse_event_uses_id_event_and_json_data() -> None:
    event = RunStartedEvent(id="7-0", run_id="run-1")

    frame = format_sse_event(event)

    assert frame.startswith("id: 7-0\nevent: run_started\ndata: ")
    assert '"run_id":"run-1"' in frame
    assert frame.endswith("\n\n")
