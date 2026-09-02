import json

import pytest

from services.dify_builder import wiring


class _FakeSubscription:
    def __init__(self, items):
        self._items = list(items)
        self.closed = False
        self.timeouts: list[float | None] = []

    def receive(self, timeout=None):
        self.timeouts.append(timeout)
        if not self._items:
            raise AssertionError("test subscription ran out of events before a terminal frame")
        return self._items.pop(0)

    def close(self):
        self.closed = True


def _event(frame: str) -> dict:
    lines = frame.strip().splitlines()
    assert lines[0] == "event: message"
    return json.loads(lines[1].removeprefix("data: "))


def test_stream_advance_frames_relays_typed_envelopes_until_terminal_state():
    view = {"session_id": "s1", "state": "fix.diagnose"}
    node = {"kind": "node", "node_id": "n1", "status": "running"}
    commit = {
        "kind": "commit",
        "session_id": "s1",
        "version": 6,
        "state": "fix.propose",
        "settled": False,
        "items": [],
    }
    state = {"kind": "state", "version": 7, "session_id": "s1"}
    extra = {"kind": "node", "node_id": "n2"}
    subscription = _FakeSubscription(
        [
            json.dumps(node).encode(),
            None,
            json.dumps(commit).encode(),
            json.dumps(state).encode(),
            json.dumps(extra).encode(),
        ]
    )

    frames = list(wiring.stream_advance_frames(view, subscription, expect_advance=True))

    assert _event(frames[0]) == {"event": "snapshot", "data": view}
    assert _event(frames[1]) == {"event": "node", "data": node}
    assert frames[2] == ": keep-alive\n\n"
    assert _event(frames[3]) == {"event": "commit", "data": commit}
    assert _event(frames[4]) == {"event": "state", "data": state}
    assert len(frames) == 5
    assert subscription.closed is True
    assert subscription.timeouts == [wiring._HEARTBEAT_SECONDS] * 4


@pytest.mark.parametrize(
    "raw",
    [
        b"not-json",
        json.dumps([]).encode(),
        json.dumps({"kind": "notice", "text": "unsupported"}).encode(),
    ],
)
def test_stream_advance_frames_turns_invalid_progress_into_typed_terminal_error(raw):
    subscription = _FakeSubscription([raw])

    frames = list(wiring.stream_advance_frames({"session_id": "s1"}, subscription, expect_advance=True))

    assert _event(frames[-1]) == {
        "event": "error",
        "data": {"kind": "error", "error": "invalid Builder progress event"},
    }
    assert subscription.closed is True


def test_stream_advance_frames_closes_on_error_event():
    error = {"kind": "error", "error": "step failed"}
    subscription = _FakeSubscription([json.dumps(error).encode()])

    frames = list(wiring.stream_advance_frames({"session_id": "s1"}, subscription, expect_advance=True))

    assert _event(frames[-1]) == {"event": "error", "data": error}
    assert subscription.closed is True


def test_stream_advance_frames_settled_call_yields_snapshot_only():
    view = {"session_id": "s1", "state": "edit.capability_check"}

    frames = list(wiring.stream_advance_frames(view, None, expect_advance=False))

    assert [_event(frame) for frame in frames] == [{"event": "snapshot", "data": view}]


def test_stream_advance_frames_can_emit_terminal_state_for_settled_message():
    view = {"session_id": "s1", "state": "success"}

    frames = list(
        wiring.stream_advance_frames(
            view,
            None,
            expect_advance=False,
            emit_state_when_settled=True,
        )
    )

    assert [_event(frame) for frame in frames] == [
        {"event": "snapshot", "data": view},
        {"event": "state", "data": {"kind": "state", **view}},
    ]
