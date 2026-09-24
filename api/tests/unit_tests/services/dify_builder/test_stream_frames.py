import json

import pytest

from core.dify_builder.models import ConversationItem
from services.dify_builder import wiring
from tests.unit_tests.services.dify_builder.workflow_stream_fixtures import native_workflow_payloads


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


def _view(**overrides) -> dict:
    return {
        "session_id": "s1",
        "version": 1,
        "canvas_read_only": False,
        "run_status": "processing",
        "interrupted": False,
        "conversation_last_seq": -1,
        "phase": "understand",
        "actions": [],
        **overrides,
    }


def _workflow_payload(event: str) -> dict:
    return next(payload for payload in native_workflow_payloads() if payload["event"] == event)


def _internal_workflow(event: str, revision: int = 1) -> dict:
    return {
        "kind": "workflow",
        "session_id": "s1",
        "operation_id": "operation-1",
        "stage_id": "build.test",
        "at_version": 2,
        "revision": revision,
        "payload": _workflow_payload(event),
    }


def _internal_finished(**overrides) -> dict:
    return {
        "kind": "command_finished",
        **_view(version=2, run_status="waiting_input"),
        "command_id": "command-1",
        **overrides,
    }


def test_stream_advance_frames_closes_subscription_when_never_iterated():
    subscription = _FakeSubscription([json.dumps(_internal_finished()).encode()])
    stream = wiring.stream_advance_frames(_view(), subscription, expect_advance=True)

    stream.close()

    assert subscription.closed is True


def test_stream_advance_frames_relays_typed_envelopes_until_command_finished():
    node = _internal_workflow("node_started")
    finished = _internal_finished()
    extra = _internal_workflow("node_started", revision=2)
    subscription = _FakeSubscription(
        [json.dumps(node).encode(), None, json.dumps(finished).encode(), json.dumps(extra).encode()]
    )

    frames = list(wiring.stream_advance_frames(_view(), subscription, expect_advance=True, command_id="command-1"))

    assert _event(frames[0]) == {
        "event": "command_started",
        "data": {
            "session_id": "s1",
            "command_id": "command-1",
            "version": 1,
            "phase": "understand",
            "run_status": "processing",
        },
    }
    workflow_event = _event(frames[1])
    assert workflow_event["event"] == "workflow"
    assert workflow_event["data"] | {"payload": None} == {
        "session_id": "s1",
        "operation_id": "operation-1",
        "at_version": 2,
        "revision": 1,
        "payload": None,
    }
    assert workflow_event["data"]["payload"]["event"] == "node_started"
    assert frames[2] == ": keep-alive\n\n"
    assert _event(frames[3]) == {
        "event": "command_finished",
        "data": {**_view(version=2, run_status="waiting_input"), "command_id": "command-1"},
    }
    assert len(frames) == 4
    assert subscription.closed is True
    assert subscription.timeouts == [wiring._HEARTBEAT_SECONDS] * 3


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

    frames = list(wiring.stream_advance_frames(_view(), subscription, expect_advance=True))

    assert _event(frames[-1]) == {
        "event": "error",
        "data": {"message": "invalid Builder progress event"},
    }
    assert subscription.closed is True


def test_stream_advance_frames_normalizes_internal_error_event():
    error = {
        "kind": "error",
        "code": "command_finished_unavailable",
        "error": "step failed",
        "session_id": "s1",
        "command_id": "command-1",
        "stage_id": "fix.verify",
        "traceback": "private",
    }
    subscription = _FakeSubscription([json.dumps(error).encode()])

    frames = list(wiring.stream_advance_frames(_view(), subscription, expect_advance=True))

    assert _event(frames[-1]) == {
        "event": "error",
        "data": {
            "message": "step failed",
            "session_id": "s1",
            "command_id": "command-1",
            "code": "command_finished_unavailable",
        },
    }
    assert subscription.closed is True


@pytest.mark.parametrize("event", ["workflow_finished", "workflow_paused", "error"])
def test_native_workflow_terminal_event_does_not_end_the_builder_command(event):
    workflow = _internal_workflow(event)
    finished = _internal_finished()
    subscription = _FakeSubscription([json.dumps(item).encode() for item in (workflow, finished)])

    frames = list(wiring.stream_advance_frames(_view(), subscription, expect_advance=True))

    assert [_event(frame)["event"] for frame in frames] == [
        "command_started",
        "workflow",
        "command_finished",
    ]
    assert _event(frames[1])["data"]["payload"]["event"] == event


def test_ignored_workflow_event_is_not_sent_to_the_browser():
    workflow = {
        "kind": "workflow",
        "session_id": "s1",
        "operation_id": "operation-1",
        "stage_id": "build.test",
        "at_version": 2,
        "revision": 1,
        "payload": {"event": "message_end", "task_id": "task-1", "id": "message-1"},
    }
    subscription = _FakeSubscription([json.dumps(workflow).encode(), json.dumps(_internal_finished()).encode()])

    frames = list(wiring.stream_advance_frames(_view(), subscription, expect_advance=True))

    assert [_event(frame)["event"] for frame in frames] == ["command_started", "command_finished"]


def test_stream_advance_frames_settled_call_yields_minimal_command_handshake_only():
    frames = list(
        wiring.stream_advance_frames(
            _view(state="edit.capability_check"),
            None,
            expect_advance=False,
            command_id="command-1",
        )
    )

    assert [_event(frame) for frame in frames] == [
        {
            "event": "command_started",
            "data": {
                "session_id": "s1",
                "command_id": "command-1",
                "version": 1,
                "phase": "understand",
                "run_status": "processing",
            },
        }
    ]


def test_stream_advance_frames_can_emit_public_command_finished_for_settled_message():
    view = _view(version=2, run_status="waiting_input", state="success", app_id="private")

    frames = list(
        wiring.stream_advance_frames(
            view,
            None,
            expect_advance=False,
            emit_command_finished_when_settled=True,
            command_id="command-1",
        )
    )

    assert [_event(frame) for frame in frames] == [
        {
            "event": "command_started",
            "data": {
                "session_id": "s1",
                "command_id": "command-1",
                "version": 2,
                "phase": "understand",
                "run_status": "waiting_input",
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


def test_reconnect_stream_skips_handshake_and_emits_settled_state():
    frames = list(
        wiring.stream_advance_frames(
            _view(version=3, run_status="waiting_confirmation"),
            None,
            expect_advance=False,
            emit_command_started=False,
            emit_command_finished_when_settled=True,
            command_id="command-3",
        )
    )

    assert [_event(frame) for frame in frames] == [
        {
            "event": "command_finished",
            "data": {
                **_view(version=3, run_status="waiting_confirmation"),
                "command_id": "command-3",
            },
        }
    ]


def test_stream_advance_frames_emits_synchronously_persisted_items_individually():
    items = [
        ConversationItem(seq=0, at_version=1, kind="user", payload={"text": "Build it"}),
        ConversationItem(seq=1, at_version=2, kind="form", payload={"variant": "build_requirements"}),
        ConversationItem(seq=2, at_version=2, kind="assistant_turn", payload={"reply_text": "private"}),
    ]

    frames = list(
        wiring.stream_advance_frames(
            _view(version=2, run_status="waiting_input", conversation_last_seq=1),
            None,
            expect_advance=False,
            command_id="command-1",
            initial_items=items,
            emit_command_finished_when_settled=True,
        )
    )

    assert [_event(frame)["event"] for frame in frames] == [
        "command_started",
        "conversation_item_appended",
        "conversation_item_appended",
        "command_finished",
    ]
    assert [_event(frame)["data"].get("item", {}).get("seq") for frame in frames] == [None, 0, 1, None]
    assert all("kind" not in _event(frame)["data"] for frame in frames)
