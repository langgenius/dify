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
