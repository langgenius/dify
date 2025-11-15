"""
Comprehensive unit tests for Redis broadcast channel implementation.

This test suite covers all aspects of the Redis broadcast channel including:
- Basic functionality and contract compliance
- Error handling and edge cases
- Thread safety and concurrency
- Resource management and cleanup
- Performance and reliability scenarios
"""

import dataclasses
import threading
import time
from collections.abc import Generator
from unittest.mock import MagicMock, patch

import pytest

from libs.broadcast_channel.exc import BroadcastChannelError, SubscriptionClosedError
from libs.broadcast_channel.redis.channel import (
    BroadcastChannel as RedisBroadcastChannel,
)
from libs.broadcast_channel.redis.channel import (
    Topic,
    _RedisSubscription,
)


class TestBroadcastChannel:
    """Test cases for the main BroadcastChannel class."""

    @pytest.fixture
    def mock_redis_client(self) -> MagicMock:
        """Create a mock Redis client for testing."""
        client = MagicMock()
        client.pubsub.return_value = MagicMock()
        return client

    @pytest.fixture
    def broadcast_channel(self, mock_redis_client: MagicMock) -> RedisBroadcastChannel:
        """Create a BroadcastChannel instance with mock Redis client."""
        return RedisBroadcastChannel(mock_redis_client)

    def test_topic_creation(self, broadcast_channel: RedisBroadcastChannel, mock_redis_client: MagicMock):
        """Test that topic() method returns a Topic instance with correct parameters."""
        topic_name = "test-topic"
        topic = broadcast_channel.topic(topic_name)

        assert isinstance(topic, Topic)
        assert topic._client == mock_redis_client
        assert topic._topic == topic_name

    def test_topic_isolation(self, broadcast_channel: RedisBroadcastChannel):
        """Test that different topic names create isolated Topic instances."""
        topic1 = broadcast_channel.topic("topic1")
        topic2 = broadcast_channel.topic("topic2")

        assert topic1 is not topic2
        assert topic1._topic == "topic1"
        assert topic2._topic == "topic2"


class TestTopic:
    """Test cases for the Topic class."""

    @pytest.fixture
    def mock_redis_client(self) -> MagicMock:
        """Create a mock Redis client for testing."""
        client = MagicMock()
        client.pubsub.return_value = MagicMock()
        return client

    @pytest.fixture
    def topic(self, mock_redis_client: MagicMock) -> Topic:
        """Create a Topic instance for testing."""
        return Topic(mock_redis_client, "test-topic")

    def test_as_producer_returns_self(self, topic: Topic):
        """Test that as_producer() returns self as Producer interface."""
        producer = topic.as_producer()
        assert producer is topic
        # Producer is a Protocol, check duck typing instead
        assert hasattr(producer, "publish")

    def test_as_subscriber_returns_self(self, topic: Topic):
        """Test that as_subscriber() returns self as Subscriber interface."""
        subscriber = topic.as_subscriber()
        assert subscriber is topic
        # Subscriber is a Protocol, check duck typing instead
        assert hasattr(subscriber, "subscribe")

    def test_publish_calls_redis_publish(self, topic: Topic, mock_redis_client: MagicMock):
        """Test that publish() calls Redis PUBLISH with correct parameters."""
        payload = b"test message"
        topic.publish(payload)

        mock_redis_client.publish.assert_called_once_with("test-topic", payload)


@dataclasses.dataclass(frozen=True)
class SubscriptionTestCase:
    """Test case data for subscription tests."""

    name: str
    buffer_size: int
    payload: bytes
    expected_messages: list[bytes]
    should_drop: bool = False
    description: str = ""


class TestRedisSubscription:
    """Test cases for the _RedisSubscription class."""

    @pytest.fixture
    def mock_pubsub(self) -> MagicMock:
        """Create a mock PubSub instance for testing."""
        pubsub = MagicMock()
        pubsub.subscribe = MagicMock()
        pubsub.unsubscribe = MagicMock()
        pubsub.close = MagicMock()
        pubsub.get_message = MagicMock()
        return pubsub

    @pytest.fixture
    def subscription(self, mock_pubsub: MagicMock) -> Generator[_RedisSubscription, None, None]:
        """Create a _RedisSubscription instance for testing."""
        subscription = _RedisSubscription(
            pubsub=mock_pubsub,
            topic="test-topic",
        )
        yield subscription
        subscription.close()

    @pytest.fixture
    def started_subscription(self, subscription: _RedisSubscription) -> _RedisSubscription:
        """Create a subscription that has been started."""
        subscription._start_if_needed()
        return subscription

    # ==================== Lifecycle Tests ====================

    def test_subscription_initialization(self, mock_pubsub: MagicMock):
        """Test that subscription is properly initialized."""
        subscription = _RedisSubscription(
            pubsub=mock_pubsub,
            topic="test-topic",
        )

        assert subscription._pubsub is mock_pubsub
        assert subscription._topic == "test-topic"
        assert not subscription._closed.is_set()
        assert subscription._dropped_count == 0
        assert subscription._listener_thread is None
        assert not subscription._started

    def test_start_if_needed_first_call(self, subscription: _RedisSubscription, mock_pubsub: MagicMock):
        """Test that _start_if_needed() properly starts subscription on first call."""
        subscription._start_if_needed()

        mock_pubsub.subscribe.assert_called_once_with("test-topic")
        assert subscription._started is True
        assert subscription._listener_thread is not None

    def test_start_if_needed_subsequent_calls(self, started_subscription: _RedisSubscription):
        """Test that _start_if_needed() doesn't start subscription on subsequent calls."""
        original_thread = started_subscription._listener_thread
        started_subscription._start_if_needed()

        # Should not create new thread or generator
        assert started_subscription._listener_thread is original_thread

    def test_start_if_needed_when_closed(self, subscription: _RedisSubscription):
        """Test that _start_if_needed() raises error when subscription is closed."""
        subscription.close()

        with pytest.raises(SubscriptionClosedError, match="The Redis subscription is closed"):
            subscription._start_if_needed()

    def test_start_if_needed_when_cleaned_up(self, subscription: _RedisSubscription):
        """Test that _start_if_needed() raises error when pubsub is None."""
        subscription._pubsub = None

        with pytest.raises(SubscriptionClosedError, match="The Redis subscription has been cleaned up"):
            subscription._start_if_needed()

    def test_context_manager_usage(self, subscription: _RedisSubscription, mock_pubsub: MagicMock):
        """Test that subscription works as context manager."""
        with subscription as sub:
            assert sub is subscription
            assert subscription._started is True
            mock_pubsub.subscribe.assert_called_once_with("test-topic")

    def test_close_idempotent(self, subscription: _RedisSubscription, mock_pubsub: MagicMock):
        """Test that close() is idempotent and can be called multiple times."""
        subscription._start_if_needed()

        # Close multiple times
        subscription.close()
        subscription.close()
        subscription.close()

        # Should only cleanup once
        mock_pubsub.unsubscribe.assert_called_once_with("test-topic")
        mock_pubsub.close.assert_called_once()
        assert subscription._pubsub is None
        assert subscription._closed.is_set()

    def test_close_cleanup(self, subscription: _RedisSubscription, mock_pubsub: MagicMock):
        """Test that close() properly cleans up all resources."""
        subscription._start_if_needed()
        thread = subscription._listener_thread

        subscription.close()

        # Verify cleanup
        mock_pubsub.unsubscribe.assert_called_once_with("test-topic")
        mock_pubsub.close.assert_called_once()
        assert subscription._pubsub is None
        assert subscription._listener_thread is None

        # Wait for thread to finish (with timeout)
        if thread and thread.is_alive():
            thread.join(timeout=1.0)
            assert not thread.is_alive()

    # ==================== Message Processing Tests ====================

    def test_message_iterator_with_messages(self, started_subscription: _RedisSubscription):
        """Test message iterator behavior with messages in queue."""
        test_messages = [b"msg1", b"msg2", b"msg3"]

        # Add messages to queue
        for msg in test_messages:
            started_subscription._queue.put_nowait(msg)

        # Iterate through messages
        iterator = iter(started_subscription)
        received_messages = []

        for msg in iterator:
            received_messages.append(msg)
            if len(received_messages) >= len(test_messages):
                break

        assert received_messages == test_messages

    def test_message_iterator_when_closed(self, subscription: _RedisSubscription):
        """Test that iterator raises error when subscription is closed."""
        subscription.close()

        with pytest.raises(BroadcastChannelError, match="The Redis subscription is closed"):
            iter(subscription)

    # ==================== Message Enqueue Tests ====================

    def test_enqueue_message_success(self, started_subscription: _RedisSubscription):
        """Test successful message enqueue."""
        payload = b"test message"

        started_subscription._enqueue_message(payload)

        assert started_subscription._queue.qsize() == 1
        assert started_subscription._queue.get_nowait() == payload

    def test_enqueue_message_when_closed(self, subscription: _RedisSubscription):
        """Test message enqueue when subscription is closed."""
        subscription.close()
        payload = b"test message"

        # Should not raise exception, but should not enqueue
        subscription._enqueue_message(payload)

        assert subscription._queue.empty()

    def test_enqueue_message_with_full_queue(self, started_subscription: _RedisSubscription):
        """Test message enqueue with full queue (dropping behavior)."""
        # Fill the queue
        for i in range(started_subscription._queue.maxsize):
            started_subscription._queue.put_nowait(f"old_msg_{i}".encode())

        # Try to enqueue new message (should drop oldest)
        new_message = b"new_message"
        started_subscription._enqueue_message(new_message)

        # Should have dropped one message and added new one
        assert started_subscription._dropped_count == 1

        # New message should be in queue
        messages = []
        while not started_subscription._queue.empty():
            messages.append(started_subscription._queue.get_nowait())

        assert new_message in messages

    # ==================== Listener Thread Tests ====================

    @patch("time.sleep", side_effect=lambda x: None)  # Speed up test
    def test_listener_thread_normal_operation(
        self, mock_sleep, subscription: _RedisSubscription, mock_pubsub: MagicMock
    ):
        """Test listener thread normal operation."""
        # Mock message from Redis
        mock_message = {"type": "message", "channel": "test-topic", "data": b"test payload"}
        mock_pubsub.get_message.return_value = mock_message

        # Start listener
        subscription._start_if_needed()

        # Wait a bit for processing
        time.sleep(0.1)

        # Verify message was processed
        assert not subscription._queue.empty()
        assert subscription._queue.get_nowait() == b"test payload"

    def test_listener_thread_ignores_subscribe_messages(self, subscription: _RedisSubscription, mock_pubsub: MagicMock):
        """Test that listener thread ignores subscribe/unsubscribe messages."""
        mock_message = {"type": "subscribe", "channel": "test-topic", "data": 1}
        mock_pubsub.get_message.return_value = mock_message

        subscription._start_if_needed()
        time.sleep(0.1)

        # Should not enqueue subscribe messages
        assert subscription._queue.empty()

    def test_listener_thread_ignores_wrong_channel(self, subscription: _RedisSubscription, mock_pubsub: MagicMock):
        """Test that listener thread ignores messages from wrong channels."""
        mock_message = {"type": "message", "channel": "wrong-topic", "data": b"test payload"}
        mock_pubsub.get_message.return_value = mock_message

        subscription._start_if_needed()
        time.sleep(0.1)

        # Should not enqueue messages from wrong channels
        assert subscription._queue.empty()

    def test_listener_thread_handles_redis_exceptions(self, subscription: _RedisSubscription, mock_pubsub: MagicMock):
        """Test that listener thread handles Redis exceptions gracefully."""
        mock_pubsub.get_message.side_effect = Exception("Redis error")

        subscription._start_if_needed()

        # Wait for thread to handle exception
        time.sleep(0.2)

        # Thread should still be alive but not processing
        assert subscription._listener_thread is not None
        assert not subscription._listener_thread.is_alive()

    def test_listener_thread_stops_when_closed(self, subscription: _RedisSubscription, mock_pubsub: MagicMock):
        """Test that listener thread stops when subscription is closed."""
        subscription._start_if_needed()
        thread = subscription._listener_thread

        # Close subscription
        subscription.close()

        # Wait for thread to finish
        if thread is not None and thread.is_alive():
            thread.join(timeout=1.0)

        assert thread is None or not thread.is_alive()

    # ==================== Table-driven Tests ====================

    @pytest.mark.parametrize(
        "test_case",
        [
            SubscriptionTestCase(
                name="basic_message",
                buffer_size=5,
                payload=b"hello world",
                expected_messages=[b"hello world"],
                description="Basic message publishing and receiving",
            ),
            SubscriptionTestCase(
                name="empty_message",
                buffer_size=5,
                payload=b"",
                expected_messages=[b""],
                description="Empty message handling",
            ),
            SubscriptionTestCase(
                name="large_message",
                buffer_size=5,
                payload=b"x" * 10000,
                expected_messages=[b"x" * 10000],
                description="Large message handling",
            ),
            SubscriptionTestCase(
                name="unicode_message",
                buffer_size=5,
                payload="你好世界".encode(),
                expected_messages=["你好世界".encode()],
                description="Unicode message handling",
            ),
        ],
    )
    def test_subscription_scenarios(self, test_case: SubscriptionTestCase, mock_pubsub: MagicMock):
        """Test various subscription scenarios using table-driven approach."""
        subscription = _RedisSubscription(
            pubsub=mock_pubsub,
            topic="test-topic",
        )

        # Simulate receiving message
        mock_message = {"type": "message", "channel": "test-topic", "data": test_case.payload}
        mock_pubsub.get_message.return_value = mock_message

        try:
            with subscription:
                # Wait for message processing
                time.sleep(0.1)

                # Collect received messages
                received = []
                for msg in subscription:
                    received.append(msg)
                    if len(received) >= len(test_case.expected_messages):
                        break

                assert received == test_case.expected_messages, f"Failed: {test_case.description}"
        finally:
            subscription.close()

    def test_concurrent_close_and_enqueue(self, started_subscription: _RedisSubscription):
        """Test concurrent close and enqueue operations."""
        errors = []

        def close_subscription():
            try:
                time.sleep(0.05)  # Small delay
                started_subscription.close()
            except Exception as e:
                errors.append(e)

        def enqueue_messages():
            try:
                for i in range(50):
                    started_subscription._enqueue_message(f"msg_{i}".encode())
                    time.sleep(0.001)
            except Exception as e:
                errors.append(e)

        # Start threads
        close_thread = threading.Thread(target=close_subscription)
        enqueue_thread = threading.Thread(target=enqueue_messages)

        close_thread.start()
        enqueue_thread.start()

        # Wait for completion
        close_thread.join(timeout=2.0)
        enqueue_thread.join(timeout=2.0)

        # Should not have any errors (operations should be safe)
        assert len(errors) == 0

    # ==================== Error Handling Tests ====================

    def test_iterator_after_close(self, subscription: _RedisSubscription):
        """Test iterator behavior after close."""
        subscription.close()

        with pytest.raises(SubscriptionClosedError, match="The Redis subscription is closed"):
            iter(subscription)

    def test_start_after_close(self, subscription: _RedisSubscription):
        """Test start attempts after close."""
        subscription.close()

        with pytest.raises(SubscriptionClosedError, match="The Redis subscription is closed"):
            subscription._start_if_needed()

    def test_pubsub_none_operations(self, subscription: _RedisSubscription):
        """Test operations when pubsub is None."""
        subscription._pubsub = None

        with pytest.raises(SubscriptionClosedError, match="The Redis subscription has been cleaned up"):
            subscription._start_if_needed()

        # Close should still work
        subscription.close()  # Should not raise

    def test_channel_name_variations(self, mock_pubsub: MagicMock):
        """Test various channel name formats."""
        channel_names = [
            "simple",
            "with-dashes",
            "with_underscores",
            "with.numbers",
            "WITH.UPPERCASE",
            "mixed-CASE_name",
            "very.long.channel.name.with.multiple.parts",
        ]

        for channel_name in channel_names:
            subscription = _RedisSubscription(
                pubsub=mock_pubsub,
                topic=channel_name,
            )

            subscription._start_if_needed()
            mock_pubsub.subscribe.assert_called_with(channel_name)
            subscription.close()

    def test_received_on_closed_subscription(self, subscription: _RedisSubscription):
        subscription.close()

        with pytest.raises(SubscriptionClosedError):
            subscription.receive()
