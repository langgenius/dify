"""Contract-level checks for the browser-facing Dify Builder SSE envelopes."""

import json
import operator
from collections.abc import Iterator

import pytest

from controllers.console.dify_builder_fields import DifyBuilderStreamEventResponse
from services.dify_builder import wiring
from tests.unit_tests.services.dify_builder.workflow_stream_fixtures import (
    native_chatflow_payloads,
    native_workflow_payloads,
)

IGNORED_WORKFLOW_EVENTS = {"message_end", "message_file", "tts_message", "tts_message_end"}
SUPPORTED_WORKFLOW_PAYLOADS = [
    payload
    for payload in native_workflow_payloads() + native_chatflow_payloads()
    if payload["event"] not in IGNORED_WORKFLOW_EVENTS
]


def _view(**overrides) -> dict:
    return {
        "session_id": "s1",
        "version": 1,
        "canvas_read_only": False,
        "run_status": "processing",
        "interrupted": False,
        "conversation_last_seq": -1,
        "phase": "modify",
        "actions": [],
        **overrides,
    }


@pytest.mark.parametrize("payload", SUPPORTED_WORKFLOW_PAYLOADS, ids=operator.itemgetter("event"))
def test_workflow_envelope_preserves_the_supported_debugger_contract(payload):
    frame = {
        "event": "workflow",
        "data": {
            "session_id": "session-1",
            "operation_id": "operation-1",
            "at_version": 2,
            "revision": 1,
            "payload": payload,
        },
    }

    parsed = DifyBuilderStreamEventResponse.model_validate(frame)
    dumped = parsed.model_dump(mode="json", exclude_none=True, exclude_unset=True)

    assert dumped["event"] == "workflow"
    assert set(dumped["data"]) == {
        "session_id",
        "operation_id",
        "at_version",
        "revision",
        "payload",
    }
    assert dumped["data"]["payload"]["event"] == payload["event"]
    assert "kind" not in dumped["data"]
    assert "stage_id" not in dumped["data"]


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


def test_stream_projects_incremental_events_and_drops_internal_fields():
    view = _view(app_id="internal-app", state="build.execution", entry_mode="build")
    canvas = {
        "kind": "canvas",
        "session_id": "s1",
        "operation_id": "operation-1",
        "stage_id": "build.execution",
        "at_version": 2,
        "revision": 1,
        "event": "add_llm_node",
        "edge": {"source": "start", "target": "answer"},
        "dify_run_id": "internal-run",
    }
    progress = {
        "kind": "progress",
        "session_id": "s1",
        "operation_id": "operation-1",
        "stage_id": "build.execution",
        "span_id": "internal-span",
        "at_version": 2,
        "revision": 1,
        "status": "running",
        "activity": {
            "id": "build-generate-graph",
            "label": "Generate the workflow graph",
            "state": "active",
            "kind": "backend-step",
        },
    }
    reasoning = {
        "kind": "reasoning",
        "session_id": "s1",
        "operation_id": "operation-1",
        "stage_id": "build.execution",
        "span_id": "build-nodes",
        "at_version": 2,
        "revision": 2,
        "delta": "I need a start, LLM, and end node.",
    }
    message = {
        "kind": "agent_message",
        "session_id": "s1",
        "command_id": "command-1",
        "operation_id": "operation-1",
        "turn_id": "message-1",
        "delta": "Working",
        "seq": 1,
        "at_version": 2,
        "revision": 1,
        "stage_id": "build.execution",
        "done": False,
        "text_bytes": 7,
    }
    finished = {
        "kind": "command_finished",
        **view,
        "version": 2,
        "run_status": "waiting_input",
        "command_id": "command-1",
        "checkpoint": {"id": "internal"},
    }
    subscription = _FakeSubscription(
        [json.dumps(item).encode() for item in (canvas, progress, reasoning, message, finished)]
    )

    frames = list(wiring.stream_advance_frames(view, subscription, expect_advance=True, command_id="command-1"))

    assert [_event(frame) for frame in frames] == [
        {
            "event": "command_started",
            "data": {
                "session_id": "s1",
                "command_id": "command-1",
                "version": 1,
                "phase": "modify",
                "run_status": "processing",
            },
        },
        {
            "event": "canvas",
            "data": {
                "session_id": "s1",
                "operation_id": "operation-1",
                "at_version": 2,
                "revision": 1,
                "event": "add_llm_node",
            },
        },
        {
            "event": "progress",
            "data": {
                "session_id": "s1",
                "operation_id": "operation-1",
                "at_version": 2,
                "revision": 1,
                "status": "running",
                "activity": {
                    "id": "build-generate-graph",
                    "label": "Generate the workflow graph",
                    "state": "active",
                },
            },
        },
        {
            "event": "reasoning",
            "data": {
                "session_id": "s1",
                "operation_id": "operation-1",
                "at_version": 2,
                "revision": 2,
                "delta": "I need a start, LLM, and end node.",
            },
        },
        {
            "event": "agent_message",
            "data": {
                "session_id": "s1",
                "command_id": "command-1",
                "operation_id": "operation-1",
                "turn_id": "message-1",
                "delta": "Working",
                "seq": 1,
                "at_version": 2,
                "revision": 1,
                "done": False,
                "text_bytes": 7,
            },
        },
        {
            "event": "command_finished",
            "data": {
                **_view(version=2, run_status="waiting_input"),
                "command_id": "command-1",
            },
        },
    ]
    for frame in frames:
        DifyBuilderStreamEventResponse.model_validate(_event(frame))
    assert subscription.closed is True


def test_command_handshake_contains_only_live_ui_status():
    view = _view(
        app_id="a1",
        state="fix.await_verify",
        entry_mode="fix",
        phase="test",
        actions=[{"id": "run_verify", "label": "Run verify", "kind": "primary"}],
    )

    frames = list(wiring.stream_advance_frames(view, None, expect_advance=False, command_id="command-1"))

    assert _event(frames[0]) == {
        "event": "command_started",
        "data": {
            "session_id": "s1",
            "command_id": "command-1",
            "version": 1,
            "phase": "test",
            "run_status": "processing",
        },
    }


def test_stream_timeout_emits_normalized_terminal_error(monkeypatch: pytest.MonkeyPatch):
    subscription = _FakeSubscription([None])
    monotonic: Iterator[float] = iter([0, 0, wiring._MAX_STREAM_SECONDS + 1])
    monkeypatch.setattr(wiring.time, "monotonic", lambda: next(monotonic))

    frames = list(wiring.stream_advance_frames(_view(), subscription, expect_advance=True, command_id="command-1"))

    assert _event(frames[-1]) == {
        "event": "error",
        "data": {
            "code": "timeout",
            "message": "Builder operation timed out",
            "session_id": "s1",
            "command_id": "command-1",
        },
    }
