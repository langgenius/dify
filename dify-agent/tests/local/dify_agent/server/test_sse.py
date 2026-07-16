import json

from dify_agent.protocol.schemas import RunFailedEvent, RunFailedEventData, RunStartedEvent
from dify_agent.server.sse import format_sse_event


def test_format_sse_event_uses_id_event_and_json_data() -> None:
    event = RunStartedEvent(id="7-0", run_id="run-1")

    frame = format_sse_event(event)

    assert frame.startswith("id: 7-0\nevent: run_started\ndata: ")
    assert '"run_id":"run-1"' in frame
    assert frame.endswith("\n\n")


def test_format_sse_event_escapes_unicode_line_separators() -> None:
    error = "next-line:\x85line-separator:\u2028paragraph-separator:\u2029done"
    event = RunFailedEvent(id="8-0", run_id="run-1", data=RunFailedEventData(error=error))

    frame = format_sse_event(event)
    data = next(line.removeprefix("data: ") for line in frame.splitlines() if line.startswith("data: "))

    assert "\x85" not in frame
    assert "\u2028" not in frame
    assert "\u2029" not in frame
    assert "\\u0085" in frame
    assert "\\u2028" in frame
    assert "\\u2029" in frame
    assert json.loads(data)["data"]["error"] == error
