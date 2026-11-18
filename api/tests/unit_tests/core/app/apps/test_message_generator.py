from collections.abc import Iterator
from unittest.mock import Mock, patch

from core.app.apps.message_generator import MessageGenerator
from core.app.entities.task_entities import StreamEvent
from libs.broadcast_channel.channel import Subscription, SupportsPreparedSubscription
from models.model import AppMode


class _StubSubscription(Subscription):
    """A subscription that never yields messages; the generator only forwards it."""

    def __iter__(self) -> Iterator[bytes]:
        return iter(())

    def receive(self, timeout: float | None = 0.1) -> bytes | None:
        # No message is ever buffered, so any timeout expires immediately.
        del timeout
        return None

    def close(self) -> None:
        return None


class _PreparedSubscriber(SupportsPreparedSubscription):
    def __init__(self) -> None:
        self.prepare_calls = 0
        self.prepared_subscription = _StubSubscription()
        self.ordinary_subscription = _StubSubscription()

    def prepare_subscription(self) -> Subscription:
        self.prepare_calls += 1
        return self.prepared_subscription

    def subscribe(self) -> Subscription:
        return self.ordinary_subscription


class _TopicWithSeparateSubscriberView:
    def __init__(self) -> None:
        self.subscriber = _PreparedSubscriber()

    def as_subscriber(self) -> _PreparedSubscriber:
        return self.subscriber

    def subscribe(self) -> Subscription:
        raise AssertionError("event retrieval must use the topic's subscriber view")


class TestMessageGenerator:
    def test_get_response_topic(self) -> None:
        channel = Mock()
        channel.topic.return_value = "topic"

        with patch("core.app.apps.message_generator.get_pubsub_broadcast_channel", return_value=channel):
            topic = MessageGenerator.get_response_topic(AppMode.WORKFLOW, "run-1")

        assert topic == "topic"
        expected_key = MessageGenerator._make_channel_key(AppMode.WORKFLOW, "run-1")
        channel.topic.assert_called_once_with(expected_key)

    def test_retrieve_events_passes_arguments(self) -> None:
        topic = Mock()
        topic.as_subscriber.return_value = topic
        topic.subscribe.return_value = "subscription"
        with (
            patch("core.app.apps.message_generator.MessageGenerator.get_response_topic", return_value=topic),
            patch(
                "core.app.apps.message_generator.stream_topic_events", return_value=iter([{"event": "ping"}])
            ) as mock_stream,
        ):
            events = list(
                MessageGenerator.retrieve_events(
                    AppMode.WORKFLOW,
                    "run-1",
                    idle_timeout=1,
                    ping_interval=2,
                    terminal_events=[StreamEvent.WORKFLOW_FINISHED.value],
                )
            )

        assert events == [{"event": "ping"}]
        topic.as_subscriber.assert_called_once_with()
        topic.subscribe.assert_called_once_with()
        mock_stream.assert_called_once_with(
            subscription="subscription",
            idle_timeout=1,
            ping_interval=2,
            on_subscribe=None,
            terminal_events=[StreamEvent.WORKFLOW_FINISHED.value],
        )

    def test_retrieve_events_uses_prepared_subscription_capability(self) -> None:
        topic = _TopicWithSeparateSubscriberView()
        with (
            patch("core.app.apps.message_generator.MessageGenerator.get_response_topic", return_value=topic),
            patch("core.app.apps.message_generator.stream_topic_events", return_value=iter([])) as mock_stream,
        ):
            events = MessageGenerator.retrieve_events(AppMode.WORKFLOW, "run-1")

        assert topic.subscriber.prepare_calls == 1
        mock_stream.assert_called_once_with(
            subscription=topic.subscriber.prepared_subscription,
            idle_timeout=300,
            ping_interval=10.0,
            on_subscribe=None,
            terminal_events=None,
        )
        assert list(events) == []
