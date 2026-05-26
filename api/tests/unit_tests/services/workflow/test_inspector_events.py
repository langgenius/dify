"""Unit tests for :mod:`services.workflow.inspector_events`.

The publisher and subscriber both touch redis, so we mock it out at the
``redis_client`` boundary. The goal is to lock down:

1. the channel-naming convention (frontend SSE doesn't need to know it but
   tests catch accidental renames),
2. the JSON envelope (``kind / workflow_run_id / node_id / status``),
3. publisher robustness when redis is unavailable,
4. subscriber's tolerance of malformed payloads and bytes-vs-str messages,
5. subscriber's heartbeat-on-idle behaviour.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any
from unittest.mock import MagicMock, patch

from services.workflow import inspector_events
from services.workflow.inspector_events import InspectorMessage

# ──────────────────────────────────────────────────────────────────────────────
# Channel + envelope
# ──────────────────────────────────────────────────────────────────────────────


def test_channel_for_returns_namespaced_key():
    assert inspector_events.channel_for("run-42") == "dify:inspector:workflow_run:run-42"


def test_inspector_message_to_json_round_trip():
    msg = InspectorMessage(kind="node_changed", workflow_run_id="r1", node_id="agent-1", status="succeeded")
    parsed = json.loads(msg.to_json())
    assert parsed == {"kind": "node_changed", "workflow_run_id": "r1", "node_id": "agent-1", "status": "succeeded"}


def test_inspector_message_from_json_rejects_bad_kind():
    blob = json.dumps({"kind": "something_else", "workflow_run_id": "r1"})
    assert InspectorMessage.from_json(blob) is None


def test_inspector_message_from_json_rejects_bad_workflow_run_id():
    blob = json.dumps({"kind": "node_changed", "workflow_run_id": ""})
    assert InspectorMessage.from_json(blob) is None


def test_inspector_message_from_json_rejects_non_string_node_id():
    blob = json.dumps({"kind": "node_changed", "workflow_run_id": "r1", "node_id": 42})
    assert InspectorMessage.from_json(blob) is None


def test_inspector_message_from_json_returns_none_for_invalid_json():
    assert InspectorMessage.from_json("{not json") is None


# ──────────────────────────────────────────────────────────────────────────────
# Publisher
# ──────────────────────────────────────────────────────────────────────────────


def test_publish_node_changed_writes_to_run_channel():
    fake_redis = MagicMock()
    with patch.object(inspector_events, "redis_client", fake_redis):
        inspector_events.publish_node_changed(workflow_run_id="run-1", node_id="agent-1", status="running")

    fake_redis.publish.assert_called_once()
    channel, blob = fake_redis.publish.call_args.args
    assert channel == "dify:inspector:workflow_run:run-1"
    msg = InspectorMessage.from_json(blob)
    assert msg is not None
    assert msg.kind == "node_changed"
    assert msg.node_id == "agent-1"
    assert msg.status == "running"


def test_publish_workflow_completed_emits_terminal_message():
    fake_redis = MagicMock()
    with patch.object(inspector_events, "redis_client", fake_redis):
        inspector_events.publish_workflow_completed(workflow_run_id="run-1", status="succeeded")

    blob = fake_redis.publish.call_args.args[1]
    msg = InspectorMessage.from_json(blob)
    assert msg is not None
    assert msg.kind == "workflow_completed"
    assert msg.node_id is None
    assert msg.status == "succeeded"


def test_publish_swallows_redis_errors():
    """Persistence must not crash if redis blows up — we publish best-effort."""

    class _BrokenRedis:
        def publish(self, *_args: Any, **_kwargs: Any) -> None:
            raise RuntimeError("redis offline")

    with patch.object(inspector_events, "redis_client", _BrokenRedis()):
        # No exception should escape.
        inspector_events.publish_node_changed(workflow_run_id="run-1", node_id="agent-1", status="running")


# ──────────────────────────────────────────────────────────────────────────────
# Subscriber
# ──────────────────────────────────────────────────────────────────────────────


def _make_fake_pubsub(messages: list[dict[str, Any] | None]) -> MagicMock:
    """Build a redis pubsub stub that replays ``messages`` then raises StopIteration."""
    pubsub = MagicMock()
    it: Iterator[dict[str, Any] | None] = iter(messages)
    pubsub.get_message.side_effect = lambda **_kwargs: next(it, None)
    return pubsub


def test_subscribe_yields_heartbeat_then_real_message():
    """Idle ticks (``get_message`` returns None) surface as a sentinel; real
    payloads decode to ``InspectorMessage`` instances."""
    payload = json.dumps(
        {"kind": "node_changed", "workflow_run_id": "run-1", "node_id": "agent-1", "status": "succeeded"}
    )
    fake_redis = MagicMock()
    fake_redis.pubsub.return_value = _make_fake_pubsub(
        [
            None,  # heartbeat tick
            {"data": payload.encode("utf-8")},  # bytes payload, real message
            None,  # heartbeat
        ]
    )
    with patch.object(inspector_events, "redis_client", fake_redis):
        gen = inspector_events.subscribe("run-1", timeout_seconds=0.0)
        first = next(gen)
        second = next(gen)
        third = next(gen)

    # First message is the heartbeat sentinel (both node_id and status are None).
    assert first.node_id is None
    assert first.status is None
    # Second is the real one.
    assert second.kind == "node_changed"
    assert second.node_id == "agent-1"
    assert second.status == "succeeded"
    # Third is another heartbeat.
    assert third.node_id is None


def test_subscribe_skips_malformed_payloads():
    fake_redis = MagicMock()
    fake_redis.pubsub.return_value = _make_fake_pubsub(
        [
            {"data": b"not json at all"},
            {"data": json.dumps({"kind": "node_changed", "workflow_run_id": "run-1"}).encode("utf-8")},
        ]
    )
    with patch.object(inspector_events, "redis_client", fake_redis):
        gen = inspector_events.subscribe("run-1", timeout_seconds=0.0)
        msg = next(gen)
    assert msg.kind == "node_changed"
    assert msg.node_id is None


def test_subscribe_unsubscribes_on_teardown():
    fake_pubsub = _make_fake_pubsub([None])
    fake_redis = MagicMock()
    fake_redis.pubsub.return_value = fake_pubsub
    with patch.object(inspector_events, "redis_client", fake_redis):
        gen = inspector_events.subscribe("run-1", timeout_seconds=0.0)
        next(gen)
        gen.close()
    fake_pubsub.unsubscribe.assert_called_once_with("dify:inspector:workflow_run:run-1")
    fake_pubsub.close.assert_called_once()
