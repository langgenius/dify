"""Tests for the session progress bus.

The bus is publish-only in P3b: the Celery advance task (Task 4) publishes
events here, and the P3c SSE endpoint (not built yet) will subscribe. There
is no live subscriber in this repo yet, so these tests mock the broadcast
channel and assert ``publish``/``subscribe`` wire up the right topic and
serialize the event correctly, rather than exercising a real Redis channel.
"""

import json
from unittest.mock import MagicMock, patch

from services.dify_builder import progress_bus

SESSION_ID = "11111111-1111-1111-1111-111111111111"


def test_publish_sends_json_encoded_event_to_the_session_topic() -> None:
    fake_channel = MagicMock()
    event = {"kind": "node", "node_id": "abc", "status": "succeeded"}

    with patch("services.dify_builder.progress_bus.get_pubsub_broadcast_channel", return_value=fake_channel):
        progress_bus.publish(SESSION_ID, event)

    fake_channel.topic.assert_called_once_with(f"dify_builder:{SESSION_ID}")
    fake_topic = fake_channel.topic.return_value
    fake_topic.publish.assert_called_once()
    (payload,) = fake_topic.publish.call_args.args
    assert isinstance(payload, bytes)
    assert json.loads(payload.decode()) == event


def test_subscribe_returns_the_session_topics_subscription() -> None:
    fake_channel = MagicMock()

    with patch("services.dify_builder.progress_bus.get_pubsub_broadcast_channel", return_value=fake_channel):
        result = progress_bus.subscribe(SESSION_ID)

    fake_channel.topic.assert_called_once_with(f"dify_builder:{SESSION_ID}")
    fake_channel.topic.return_value.subscribe.assert_called_once_with()
    assert result is fake_channel.topic.return_value.subscribe.return_value
