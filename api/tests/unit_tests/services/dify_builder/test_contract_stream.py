"""Contract-level checks for typed Dify Builder SSE envelopes."""

import json

from services.dify_builder import wiring


class _FakeSubscription:
    def __init__(self, items):
        self._items = list(items)
        self.closed = False

    def receive(self, timeout=None):  # noqa: ARG002
        if not self._items:
            raise AssertionError("test subscription ran out of events")
        return self._items.pop(0)

    def close(self):
        self.closed = True


def _event(frame: str) -> dict:
    lines = frame.strip().splitlines()
    assert lines[0] == "event: message"
    return json.loads(lines[1].removeprefix("data: "))


def test_stream_relays_canvas_and_agent_message_as_typed_events():
    view = {"session_id": "s1", "state": "build.execution", "phase": "modify", "actions": []}
    canvas = {"kind": "canvas", "event": "add_llm_node"}
    message = {
        "kind": "agent_message",
        "turn_id": "turn-1",
        "message_id": "message-1",
        "answer": "Working",
    }
    state = {"kind": "state", **view, "run_status": "waiting_input"}
    subscription = _FakeSubscription(
        [json.dumps(canvas).encode(), json.dumps(message).encode(), json.dumps(state).encode()]
    )

    frames = list(wiring.stream_advance_frames(view, subscription, expect_advance=True))

    assert [_event(frame) for frame in frames] == [
        {"event": "snapshot", "data": view},
        {"event": "canvas", "data": canvas},
        {"event": "agent_message", "data": message},
        {"event": "state", "data": state},
    ]
    assert subscription.closed is True


def test_snapshot_round_trips_extended_session_view_fields():
    view = {
        "session_id": "s1",
        "app_id": "a1",
        "version": 3,
        "state": "fix.await_verify",
        "canvas_read_only": False,
        "run_status": "waiting_input",
        "interrupted": False,
        "conversation": [],
        "entry_mode": "fix",
        "phase": "test",
        "actions": [{"id": "run_verify", "label": "Run verify", "kind": "primary"}],
        "checkpoint": None,
    }

    frames = list(wiring.stream_advance_frames(view, None, expect_advance=False))

    assert _event(frames[0]) == {"event": "snapshot", "data": view}
