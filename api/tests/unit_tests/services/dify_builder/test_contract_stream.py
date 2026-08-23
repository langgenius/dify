"""Locks the SSE frame-relay contract for the new Build/Edit frame kinds
(Task 4, spec §3): ``stream_frames`` already relays ANY bus message
generically as ``event: {kind}`` (it reads ``json.loads(raw).get("kind",
"message")``) -- it has no frame-kind switch to extend. This test proves
that generic relay covers ``item``/``trace``/``canvas``/``notice`` the same
way it already covers ``node``/``state`` (see ``test_stream_frames.py``),
and that a ``view_dict`` carrying the widened ``SessionView`` fields
(``phase``, ``actions``) round-trips into the snapshot frame unchanged.

Mirrors ``test_stream_frames.py``'s fake-subscription style.
"""

import json

from libs.broadcast_channel.exc import SubscriptionClosedError
from services.dify_builder import wiring


class _FakeSub:
    def __init__(self, items):
        self._items = list(items)  # bytes entries queued for receive()
        self.closed = False

    def receive(self, timeout=None):  # noqa: ARG002
        if self._items:
            return self._items.pop(0)
        raise SubscriptionClosedError("closed")

    def close(self):
        self.closed = True


def test_stream_frames_relays_item_trace_canvas_notice_frame_kinds():
    view = {"session_id": "s1", "state": "build.execution", "phase": "modify", "actions": []}
    item = json.dumps({"kind": "item", "seq": 1, "item_kind": "assistant_turn", "payload": {}}).encode()
    trace = json.dumps({"kind": "trace", "turn_id": "t1", "status": "running", "steps": []}).encode()
    canvas = json.dumps({"kind": "canvas", "event": "add_llm_node"}).encode()
    notice = json.dumps({"kind": "notice", "text": "heads up", "tone": "neutral"}).encode()

    sub = _FakeSub([item, trace, canvas, notice])
    frames = list(wiring.stream_frames(view, sub))

    assert frames[0] == f"event: snapshot\ndata: {json.dumps(view)}\n\n"
    assert frames[1] == f"event: item\ndata: {item.decode()}\n\n"
    assert frames[2] == f"event: trace\ndata: {trace.decode()}\n\n"
    assert frames[3] == f"event: canvas\ndata: {canvas.decode()}\n\n"
    assert frames[4] == f"event: notice\ndata: {notice.decode()}\n\n"
    assert sub.closed is True  # `finally: subscription.close()` still runs


def test_stream_frames_snapshot_round_trips_extended_session_view_fields():
    # The extended SessionView (Task 4's `state` frame shape: version, phase,
    # run_status, state, canvas_read_only, actions) must reach the FE
    # unmodified in the snapshot frame -- stream_frames only serializes the
    # dict handed to it, it never reshapes it.
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
    sub = _FakeSub([])

    frames = list(wiring.stream_frames(view, sub))

    assert frames[0] == f"event: snapshot\ndata: {json.dumps(view)}\n\n"
    snapshot_data = json.loads(frames[0].split("data: ", 1)[1].strip())
    assert snapshot_data["phase"] == "test"
    assert snapshot_data["actions"] == [{"id": "run_verify", "label": "Run verify", "kind": "primary"}]
    assert sub.closed is True
