import json

from libs.broadcast_channel.exc import SubscriptionClosedError
from services.dify_builder import wiring


class _FakeSub:
    def __init__(self, items):
        self._items = list(items)  # bytes | None entries; None => a receive() timeout
        self.closed = False
        self.timeouts: list[float | None] = []

    def receive(self, timeout=None):
        self.timeouts.append(timeout)
        if self._items:
            return self._items.pop(0)
        raise SubscriptionClosedError("closed")

    def close(self):
        self.closed = True


class _FakeSubscription:
    def __init__(self, items):
        self._items = list(items)  # bytes entries popped in order
        self.closed = False
        self.timeouts: list[float | None] = []

    def receive(self, timeout=None):
        self.timeouts.append(timeout)
        if self._items:
            return self._items.pop(0)
        return None

    def close(self):
        self.closed = True


def test_stream_frames_snapshot_heartbeat_events_then_close():
    view = {"session_id": "s1", "state": "fix.verify"}
    node = json.dumps({"kind": "node", "node_id": "output", "status": "running"}).encode()
    state = json.dumps({"kind": "state", "version": 5, "state": "success"}).encode()
    sub = _FakeSub([node, None, state])  # event, timeout(heartbeat), event, then closed
    frames = list(wiring.stream_frames(view, sub))
    assert frames[0] == f"event: snapshot\ndata: {json.dumps(view)}\n\n"
    assert frames[1] == f"event: node\ndata: {node.decode()}\n\n"
    assert frames[2] == ": keep-alive\n\n"
    assert frames[3] == f"event: state\ndata: {state.decode()}\n\n"
    assert sub.closed is True  # generator closed the subscription in finally


def test_stream_frames_malformed_json_falls_back_to_message_kind():
    view = {"session_id": "s1", "state": "fix.verify"}
    malformed = b"not-json"
    sub = _FakeSub([malformed])
    frames = list(wiring.stream_frames(view, sub))
    assert frames[0] == f"event: snapshot\ndata: {json.dumps(view)}\n\n"
    assert frames[1] == f"event: message\ndata: {malformed.decode()}\n\n"
    assert sub.closed is True


def test_stream_advance_frames_relays_until_terminal_state_then_closes():
    from services.dify_builder.wiring import stream_advance_frames

    view = {"session_id": "s1", "state": "fix.diagnose"}
    node = json.dumps({"kind": "node", "node_id": "n1", "status": "running"}).encode()
    state = json.dumps({"kind": "state", "version": 7, "session_id": "s1"}).encode()
    extra = json.dumps({"kind": "node", "node_id": "n2"}).encode()  # must NOT be relayed (after terminal)
    sub = _FakeSubscription([node, state, extra])  # reuse this file's fake; .receive pops in order

    frames = list(stream_advance_frames(view, sub, expect_advance=True))

    assert frames[0] == f"event: snapshot\ndata: {json.dumps(view)}\n\n"
    assert frames[1] == f"event: node\ndata: {node.decode()}\n\n"
    assert frames[2] == f"event: state\ndata: {state.decode()}\n\n"
    assert len(frames) == 3            # closed at the terminal state frame; `extra` not relayed
    assert sub.closed is True


def test_stream_advance_frames_closes_on_error_frame():
    from services.dify_builder.wiring import stream_advance_frames

    err = json.dumps({"kind": "error", "error": "step failed"}).encode()
    sub = _FakeSubscription([err])
    frames = list(stream_advance_frames({"session_id": "s1"}, sub, expect_advance=True))
    assert frames[-1] == f"event: error\ndata: {err.decode()}\n\n"
    assert sub.closed is True


def test_stream_advance_frames_settle_only_yields_snapshot_and_closes():
    from services.dify_builder.wiring import stream_advance_frames

    view = {"session_id": "s1", "state": "edit.capability_check"}
    frames = list(stream_advance_frames(view, None, expect_advance=False))
    assert frames == [f"event: snapshot\ndata: {json.dumps(view)}\n\n"]
