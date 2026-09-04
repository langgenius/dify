"""Contract-level checks for typed Dify Builder SSE envelopes."""

import json
from collections.abc import Iterator

import pytest

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


def test_stream_relays_canvas_execution_reasoning_and_agent_message_as_typed_events():
    view = {"session_id": "s1", "state": "build.execution", "phase": "modify", "actions": []}
    canvas = {
        "kind": "canvas",
        "session_id": "s1",
        "operation_id": "operation-1",
        "stage_id": "build.execution",
        "at_version": 2,
        "revision": 1,
        "event": "add_llm_node",
    }
    message = {
        "kind": "agent_message",
        "session_id": "s1",
        "operation_id": "operation-1",
        "id": "message-1",
        "answer": "Working",
        "seq": 1,
        "at_version": 2,
        "revision": 1,
        "stage_id": "build.execution",
    }
    reasoning = {
        "kind": "reasoning",
        "session_id": "s1",
        "operation_id": "operation-1",
        "stage_id": "build.execution",
        "at_version": 2,
        "revision": 2,
        "span_id": "build-nodes",
        "delta": "I need a start, LLM, and end node.",
    }
    progress = {
        "kind": "progress",
        "session_id": "s1",
        "operation_id": "operation-1",
        "stage_id": "build.execution",
        "at_version": 2,
        "revision": 1,
        "execution": {
            "status": "running",
            "activities": [
                {
                    "id": "build-generate-graph",
                    "label": "Generate the workflow graph",
                    "state": "active",
                }
            ],
        },
    }
    state = {"kind": "state", **view, "run_status": "waiting_input"}
    subscription = _FakeSubscription(
        [
            json.dumps(canvas).encode(),
            json.dumps(progress).encode(),
            json.dumps(reasoning).encode(),
            json.dumps(message).encode(),
            json.dumps(state).encode(),
        ]
    )

    frames = list(wiring.stream_advance_frames(view, subscription, expect_advance=True))

    assert [_event(frame) for frame in frames] == [
        {"event": "command_started", "data": {"kind": "command_started", **view}},
        {"event": "canvas", "data": canvas},
        {"event": "progress", "data": progress},
        {"event": "reasoning", "data": reasoning},
        {"event": "agent_message", "data": message},
        {"event": "state", "data": state},
    ]
    assert subscription.closed is True


def test_command_handshake_round_trips_bounded_session_view_fields():
    view = {
        "session_id": "s1",
        "app_id": "a1",
        "version": 3,
        "state": "fix.await_verify",
        "canvas_read_only": False,
        "run_status": "waiting_input",
        "interrupted": False,
        "conversation_last_seq": 12,
        "entry_mode": "fix",
        "phase": "test",
        "actions": [{"id": "run_verify", "label": "Run verify", "kind": "primary"}],
        "checkpoint": None,
    }

    frames = list(wiring.stream_advance_frames(view, None, expect_advance=False))

    assert _event(frames[0]) == {
        "event": "command_started",
        "data": {"kind": "command_started", **view},
    }
    assert "conversation" not in _event(frames[0])["data"]


def test_stream_timeout_emits_recoverable_terminal_error(monkeypatch: pytest.MonkeyPatch):
    subscription = _FakeSubscription([None])
    monotonic: Iterator[float] = iter([0, 0, wiring._MAX_STREAM_SECONDS + 1])
    monkeypatch.setattr(wiring.time, "monotonic", lambda: next(monotonic))

    frames = list(
        wiring.stream_advance_frames(
            {"session_id": "s1", "state": "build.execution"},
            subscription,
            expect_advance=True,
        )
    )

    assert _event(frames[-1]) == {
        "event": "error",
        "data": {
            "kind": "error",
            "error": "Builder operation timed out",
            "code": "timeout",
            "recoverable": True,
        },
    }
