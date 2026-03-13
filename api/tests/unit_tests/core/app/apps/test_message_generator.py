from unittest.mock import Mock, patch

from core.app.apps.message_generator import MessageGenerator
from models.model import AppMode


class TestMessageGenerator:
    def test_get_response_topic(self):
        channel = Mock()
        channel.topic.return_value = "topic"

        with patch("core.app.apps.message_generator.get_pubsub_broadcast_channel", return_value=channel):
            topic = MessageGenerator.get_response_topic(AppMode.WORKFLOW, "run-1")

        assert topic == "topic"
        expected_key = MessageGenerator._make_channel_key(AppMode.WORKFLOW, "run-1")
        channel.topic.assert_called_once_with(expected_key)

    def test_retrieve_events_passes_arguments(self):
        with (
            patch("core.app.apps.message_generator.MessageGenerator.get_response_topic", return_value="topic"),
            patch(
                "core.app.apps.message_generator.stream_topic_events", return_value=iter([{"event": "ping"}])
            ) as mock_stream,
        ):
            events = list(MessageGenerator.retrieve_events(AppMode.WORKFLOW, "run-1", idle_timeout=1, ping_interval=2))

        assert events == [{"event": "ping"}]
        mock_stream.assert_called_once()
