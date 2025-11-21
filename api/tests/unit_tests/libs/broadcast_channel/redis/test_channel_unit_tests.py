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
from libs.broadcast_channel.redis.sharded_channel import (
    ShardedRedisBroadcastChannel,
    ShardedTopic,
    _RedisShardedSubscription,
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
        """Create a BroadcastChannel instance with mock Redis client (regular)."""
        return RedisBroadcastChannel(mock_redis_client)

    @pytest.fixture
    def sharded_broadcast_channel(self, mock_redis_client: MagicMock) -> ShardedRedisBroadcastChannel:
        """Create a ShardedRedisBroadcastChannel instance with mock Redis client."""
        return ShardedRedisBroadcastChannel(mock_redis_client)

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

    def test_sharded_topic_creation(
        self, sharded_broadcast_channel: ShardedRedisBroadcastChannel, mock_redis_client: MagicMock
    ):
        """Test that topic() on ShardedRedisBroadcastChannel returns a ShardedTopic instance with correct parameters."""
        topic_name = "test-sharded-topic"
        sharded_topic = sharded_broadcast_channel.topic(topic_name)

        assert isinstance(sharded_topic, ShardedTopic)
        assert sharded_topic._client == mock_redis_client
        assert sharded_topic._topic == topic_name

    def test_sharded_topic_isolation(self, sharded_broadcast_channel: ShardedRedisBroadcastChannel):
        """Test that different sharded topic names create isolated ShardedTopic instances."""
        topic1 = sharded_broadcast_channel.topic("sharded-topic1")
        topic2 = sharded_broadcast_channel.topic("sharded-topic2")

        assert topic1 is not topic2
        assert topic1._topic == "sharded-topic1"
        assert topic2._topic == "sharded-topic2"

    def test_regular_and_sharded_topic_isolation(
        self, broadcast_channel: RedisBroadcastChannel, sharded_broadcast_channel: ShardedRedisBroadcastChannel
    ):
        """Test that regular topics and sharded topics from different channels are separate instances."""
        regular_topic = broadcast_channel.topic("test-topic")
        sharded_topic = sharded_broadcast_channel.topic("test-topic")

        assert isinstance(regular_topic, Topic)
        assert isinstance(sharded_topic, ShardedTopic)
        assert regular_topic is not sharded_topic
        assert regular_topic._topic == sharded_topic._topic


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


class TestShardedTopic:
    """Test cases for the ShardedTopic class."""

    @pytest.fixture
    def mock_redis_client(self) -> MagicMock:
        """Create a mock Redis client for testing."""
        client = MagicMock()
        client.pubsub.return_value = MagicMock()
        return client

    @pytest.fixture
    def sharded_topic(self, mock_redis_client: MagicMock) -> ShardedTopic:
        """Create a ShardedTopic instance for testing."""
        return ShardedTopic(mock_redis_client, "test-sharded-topic")

    def test_as_producer_returns_self(self, sharded_topic: ShardedTopic):
        """Test that as_producer() returns self as Producer interface."""
        producer = sharded_topic.as_producer()
        assert producer is sharded_topic
        # Producer is a Protocol, check duck typing instead
        assert hasattr(producer, "publish")

    def test_as_subscriber_returns_self(self, sharded_topic: ShardedTopic):
        """Test that as_subscriber() returns self as Subscriber interface."""
        subscriber = sharded_topic.as_subscriber()
        assert subscriber is sharded_topic
        # Subscriber is a Protocol, check duck typing instead
        assert hasattr(subscriber, "subscribe")

    def test_publish_calls_redis_spublish(self, sharded_topic: ShardedTopic, mock_redis_client: MagicMock):
        """Test that publish() calls Redis SPUBLISH with correct parameters."""
        payload = b"test sharded message"
        sharded_topic.publish(payload)

        mock_redis_client.spublish.assert_called_once_with("test-sharded-topic", payload)

    def test_subscribe_returns_sharded_subscription(self, sharded_topic: ShardedTopic, mock_redis_client: MagicMock):
        """Test that subscribe() returns a _RedisShardedSubscription instance."""
        subscription = sharded_topic.subscribe()

        assert isinstance(subscription, _RedisShardedSubscription)
        assert subscription._pubsub is mock_redis_client.pubsub.return_value
        assert subscription._topic == "test-sharded-topic"


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

        with pytest.raises(SubscriptionClosedError, match="The Redis regular subscription is closed"):
            subscription._start_if_needed()

    def test_start_if_needed_when_cleaned_up(self, subscription: _RedisSubscription):
        """Test that _start_if_needed() raises error when pubsub is None."""
        subscription._pubsub = None

        with pytest.raises(SubscriptionClosedError, match="The Redis regular subscription has been cleaned up"):
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

        with pytest.raises(BroadcastChannelError, match="The Redis regular subscription is closed"):
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

        with pytest.raises(SubscriptionClosedError, match="The Redis regular subscription is closed"):
            iter(subscription)

    def test_start_after_close(self, subscription: _RedisSubscription):
        """Test start attempts after close."""
        subscription.close()

        with pytest.raises(SubscriptionClosedError, match="The Redis regular subscription is closed"):
            subscription._start_if_needed()

    def test_pubsub_none_operations(self, subscription: _RedisSubscription):
        """Test operations when pubsub is None."""
        subscription._pubsub = None

        with pytest.raises(SubscriptionClosedError, match="The Redis regular subscription has been cleaned up"):
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


class TestRedisShardedSubscription:
    """Test cases for the _RedisShardedSubscription class."""

    @pytest.fixture
    def mock_pubsub(self) -> MagicMock:
        """Create a mock PubSub instance for testing."""
        pubsub = MagicMock()
        pubsub.ssubscribe = MagicMock()
        pubsub.sunsubscribe = MagicMock()
        pubsub.close = MagicMock()
        pubsub.get_sharded_message = MagicMock()
        return pubsub

    @pytest.fixture
    def sharded_subscription(self, mock_pubsub: MagicMock) -> Generator[_RedisShardedSubscription, None, None]:
        """Create a _RedisShardedSubscription instance for testing."""
        subscription = _RedisShardedSubscription(
            pubsub=mock_pubsub,
            topic="test-sharded-topic",
        )
        yield subscription
        subscription.close()

    @pytest.fixture
    def started_sharded_subscription(
        self, sharded_subscription: _RedisShardedSubscription
    ) -> _RedisShardedSubscription:
        """Create a sharded subscription that has been started."""
        sharded_subscription._start_if_needed()
        return sharded_subscription

    # ==================== Lifecycle Tests ====================

    def test_sharded_subscription_initialization(self, mock_pubsub: MagicMock):
        """Test that sharded subscription is properly initialized."""
        subscription = _RedisShardedSubscription(
            pubsub=mock_pubsub,
            topic="test-sharded-topic",
        )

        assert subscription._pubsub is mock_pubsub
        assert subscription._topic == "test-sharded-topic"
        assert not subscription._closed.is_set()
        assert subscription._dropped_count == 0
        assert subscription._listener_thread is None
        assert not subscription._started

    def test_start_if_needed_first_call(self, sharded_subscription: _RedisShardedSubscription, mock_pubsub: MagicMock):
        """Test that _start_if_needed() properly starts sharded subscription on first call."""
        sharded_subscription._start_if_needed()

        mock_pubsub.ssubscribe.assert_called_once_with("test-sharded-topic")
        assert sharded_subscription._started is True
        assert sharded_subscription._listener_thread is not None

    def test_start_if_needed_subsequent_calls(self, started_sharded_subscription: _RedisShardedSubscription):
        """Test that _start_if_needed() doesn't start sharded subscription on subsequent calls."""
        original_thread = started_sharded_subscription._listener_thread
        started_sharded_subscription._start_if_needed()

        # Should not create new thread or generator
        assert started_sharded_subscription._listener_thread is original_thread

    def test_start_if_needed_when_closed(self, sharded_subscription: _RedisShardedSubscription):
        """Test that _start_if_needed() raises error when sharded subscription is closed."""
        sharded_subscription.close()

        with pytest.raises(SubscriptionClosedError, match="The Redis sharded subscription is closed"):
            sharded_subscription._start_if_needed()

    def test_start_if_needed_when_cleaned_up(self, sharded_subscription: _RedisShardedSubscription):
        """Test that _start_if_needed() raises error when pubsub is None."""
        sharded_subscription._pubsub = None

        with pytest.raises(SubscriptionClosedError, match="The Redis sharded subscription has been cleaned up"):
            sharded_subscription._start_if_needed()

    def test_context_manager_usage(self, sharded_subscription: _RedisShardedSubscription, mock_pubsub: MagicMock):
        """Test that sharded subscription works as context manager."""
        with sharded_subscription as sub:
            assert sub is sharded_subscription
            assert sharded_subscription._started is True
            mock_pubsub.ssubscribe.assert_called_once_with("test-sharded-topic")

    def test_close_idempotent(self, sharded_subscription: _RedisShardedSubscription, mock_pubsub: MagicMock):
        """Test that close() is idempotent and can be called multiple times."""
        sharded_subscription._start_if_needed()

        # Close multiple times
        sharded_subscription.close()
        sharded_subscription.close()
        sharded_subscription.close()

        # Should only cleanup once
        mock_pubsub.sunsubscribe.assert_called_once_with("test-sharded-topic")
        mock_pubsub.close.assert_called_once()
        assert sharded_subscription._pubsub is None
        assert sharded_subscription._closed.is_set()

    def test_close_cleanup(self, sharded_subscription: _RedisShardedSubscription, mock_pubsub: MagicMock):
        """Test that close() properly cleans up all resources."""
        sharded_subscription._start_if_needed()
        thread = sharded_subscription._listener_thread

        sharded_subscription.close()

        # Verify cleanup
        mock_pubsub.sunsubscribe.assert_called_once_with("test-sharded-topic")
        mock_pubsub.close.assert_called_once()
        assert sharded_subscription._pubsub is None
        assert sharded_subscription._listener_thread is None

        # Wait for thread to finish (with timeout)
        if thread and thread.is_alive():
            thread.join(timeout=1.0)
            assert not thread.is_alive()

    # ==================== Message Processing Tests ====================

    def test_message_iterator_with_messages(self, started_sharded_subscription: _RedisShardedSubscription):
        """Test message iterator behavior with messages in queue."""
        test_messages = [b"sharded_msg1", b"sharded_msg2", b"sharded_msg3"]

        # Add messages to queue
        for msg in test_messages:
            started_sharded_subscription._queue.put_nowait(msg)

        # Iterate through messages
        iterator = iter(started_sharded_subscription)
        received_messages = []

        for msg in iterator:
            received_messages.append(msg)
            if len(received_messages) >= len(test_messages):
                break

        assert received_messages == test_messages

    def test_message_iterator_when_closed(self, sharded_subscription: _RedisShardedSubscription):
        """Test that iterator raises error when sharded subscription is closed."""
        sharded_subscription.close()

        with pytest.raises(SubscriptionClosedError, match="The Redis sharded subscription is closed"):
            iter(sharded_subscription)

    # ==================== Message Enqueue Tests ====================

    def test_enqueue_message_success(self, started_sharded_subscription: _RedisShardedSubscription):
        """Test successful message enqueue."""
        payload = b"test sharded message"

        started_sharded_subscription._enqueue_message(payload)

        assert started_sharded_subscription._queue.qsize() == 1
        assert started_sharded_subscription._queue.get_nowait() == payload

    def test_enqueue_message_when_closed(self, sharded_subscription: _RedisShardedSubscription):
        """Test message enqueue when sharded subscription is closed."""
        sharded_subscription.close()
        payload = b"test sharded message"

        # Should not raise exception, but should not enqueue
        sharded_subscription._enqueue_message(payload)

        assert sharded_subscription._queue.empty()

    def test_enqueue_message_with_full_queue(self, started_sharded_subscription: _RedisShardedSubscription):
        """Test message enqueue with full queue (dropping behavior)."""
        # Fill the queue
        for i in range(started_sharded_subscription._queue.maxsize):
            started_sharded_subscription._queue.put_nowait(f"old_msg_{i}".encode())

        # Try to enqueue new message (should drop oldest)
        new_message = b"new_sharded_message"
        started_sharded_subscription._enqueue_message(new_message)

        # Should have dropped one message and added new one
        assert started_sharded_subscription._dropped_count == 1

        # New message should be in queue
        messages = []
        while not started_sharded_subscription._queue.empty():
            messages.append(started_sharded_subscription._queue.get_nowait())

        assert new_message in messages

    # ==================== Listener Thread Tests ====================

    @patch("time.sleep", side_effect=lambda x: None)  # Speed up test
    def test_listener_thread_normal_operation(
        self, mock_sleep, sharded_subscription: _RedisShardedSubscription, mock_pubsub: MagicMock
    ):
        """Test sharded listener thread normal operation."""
        # Mock sharded message from Redis
        mock_message = {"type": "smessage", "channel": "test-sharded-topic", "data": b"test sharded payload"}
        mock_pubsub.get_sharded_message.return_value = mock_message

        # Start listener
        sharded_subscription._start_if_needed()

        # Wait a bit for processing
        time.sleep(0.1)

        # Verify message was processed
        assert not sharded_subscription._queue.empty()
        assert sharded_subscription._queue.get_nowait() == b"test sharded payload"

    def test_listener_thread_ignores_subscribe_messages(
        self, sharded_subscription: _RedisShardedSubscription, mock_pubsub: MagicMock
    ):
        """Test that listener thread ignores ssubscribe/sunsubscribe messages."""
        mock_message = {"type": "ssubscribe", "channel": "test-sharded-topic", "data": 1}
        mock_pubsub.get_sharded_message.return_value = mock_message

        sharded_subscription._start_if_needed()
        time.sleep(0.1)

        # Should not enqueue ssubscribe messages
        assert sharded_subscription._queue.empty()

    def test_listener_thread_ignores_wrong_channel(
        self, sharded_subscription: _RedisShardedSubscription, mock_pubsub: MagicMock
    ):
        """Test that listener thread ignores messages from wrong channels."""
        mock_message = {"type": "smessage", "channel": "wrong-sharded-topic", "data": b"test payload"}
        mock_pubsub.get_sharded_message.return_value = mock_message

        sharded_subscription._start_if_needed()
        time.sleep(0.1)

        # Should not enqueue messages from wrong channels
        assert sharded_subscription._queue.empty()

    def test_listener_thread_ignores_regular_messages(
        self, sharded_subscription: _RedisShardedSubscription, mock_pubsub: MagicMock
    ):
        """Test that listener thread ignores regular (non-sharded) messages."""
        mock_message = {"type": "message", "channel": "test-sharded-topic", "data": b"test payload"}
        mock_pubsub.get_sharded_message.return_value = mock_message

        sharded_subscription._start_if_needed()
        time.sleep(0.1)

        # Should not enqueue regular messages in sharded subscription
        assert sharded_subscription._queue.empty()

    def test_listener_thread_handles_redis_exceptions(
        self, sharded_subscription: _RedisShardedSubscription, mock_pubsub: MagicMock
    ):
        """Test that listener thread handles Redis exceptions gracefully."""
        mock_pubsub.get_sharded_message.side_effect = Exception("Redis error")

        sharded_subscription._start_if_needed()

        # Wait for thread to handle exception
        time.sleep(0.2)

        # Thread should still be alive but not processing
        assert sharded_subscription._listener_thread is not None
        assert not sharded_subscription._listener_thread.is_alive()

    def test_listener_thread_stops_when_closed(
        self, sharded_subscription: _RedisShardedSubscription, mock_pubsub: MagicMock
    ):
        """Test that listener thread stops when sharded subscription is closed."""
        sharded_subscription._start_if_needed()
        thread = sharded_subscription._listener_thread

        # Close subscription
        sharded_subscription.close()

        # Wait for thread to finish
        if thread is not None and thread.is_alive():
            thread.join(timeout=1.0)

        assert thread is None or not thread.is_alive()

    # ==================== Table-driven Tests ====================

    @pytest.mark.parametrize(
        "test_case",
        [
            SubscriptionTestCase(
                name="basic_sharded_message",
                buffer_size=5,
                payload=b"hello sharded world",
                expected_messages=[b"hello sharded world"],
                description="Basic sharded message publishing and receiving",
            ),
            SubscriptionTestCase(
                name="empty_sharded_message",
                buffer_size=5,
                payload=b"",
                expected_messages=[b""],
                description="Empty sharded message handling",
            ),
            SubscriptionTestCase(
                name="large_sharded_message",
                buffer_size=5,
                payload=b"x" * 10000,
                expected_messages=[b"x" * 10000],
                description="Large sharded message handling",
            ),
            SubscriptionTestCase(
                name="unicode_sharded_message",
                buffer_size=5,
                payload="你好世界".encode(),
                expected_messages=["你好世界".encode()],
                description="Unicode sharded message handling",
            ),
        ],
    )
    def test_sharded_subscription_scenarios(self, test_case: SubscriptionTestCase, mock_pubsub: MagicMock):
        """Test various sharded subscription scenarios using table-driven approach."""
        subscription = _RedisShardedSubscription(
            pubsub=mock_pubsub,
            topic="test-sharded-topic",
        )

        # Simulate receiving sharded message
        mock_message = {"type": "smessage", "channel": "test-sharded-topic", "data": test_case.payload}
        mock_pubsub.get_sharded_message.return_value = mock_message

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

    def test_concurrent_close_and_enqueue(self, started_sharded_subscription: _RedisShardedSubscription):
        """Test concurrent close and enqueue operations for sharded subscription."""
        errors = []

        def close_subscription():
            try:
                time.sleep(0.05)  # Small delay
                started_sharded_subscription.close()
            except Exception as e:
                errors.append(e)

        def enqueue_messages():
            try:
                for i in range(50):
                    started_sharded_subscription._enqueue_message(f"sharded_msg_{i}".encode())
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

    def test_iterator_after_close(self, sharded_subscription: _RedisShardedSubscription):
        """Test iterator behavior after close for sharded subscription."""
        sharded_subscription.close()

        with pytest.raises(SubscriptionClosedError, match="The Redis sharded subscription is closed"):
            iter(sharded_subscription)

    def test_start_after_close(self, sharded_subscription: _RedisShardedSubscription):
        """Test start attempts after close for sharded subscription."""
        sharded_subscription.close()

        with pytest.raises(SubscriptionClosedError, match="The Redis sharded subscription is closed"):
            sharded_subscription._start_if_needed()

    def test_pubsub_none_operations(self, sharded_subscription: _RedisShardedSubscription):
        """Test operations when pubsub is None for sharded subscription."""
        sharded_subscription._pubsub = None

        with pytest.raises(SubscriptionClosedError, match="The Redis sharded subscription has been cleaned up"):
            sharded_subscription._start_if_needed()

        # Close should still work
        sharded_subscription.close()  # Should not raise

    def test_channel_name_variations(self, mock_pubsub: MagicMock):
        """Test various sharded channel name formats."""
        channel_names = [
            "simple",
            "with-dashes",
            "with_underscores",
            "with.numbers",
            "WITH.UPPERCASE",
            "mixed-CASE_name",
            "very.long.sharded.channel.name.with.multiple.parts",
        ]

        for channel_name in channel_names:
            subscription = _RedisShardedSubscription(
                pubsub=mock_pubsub,
                topic=channel_name,
            )

            subscription._start_if_needed()
            mock_pubsub.ssubscribe.assert_called_with(channel_name)
            subscription.close()

    def test_receive_on_closed_sharded_subscription(self, sharded_subscription: _RedisShardedSubscription):
        """Test receive method on closed sharded subscription."""
        sharded_subscription.close()

        with pytest.raises(SubscriptionClosedError):
            sharded_subscription.receive()

    def test_receive_with_timeout(self, started_sharded_subscription: _RedisShardedSubscription):
        """Test receive method with timeout for sharded subscription."""
        # Should return None when no message available and timeout expires
        result = started_sharded_subscription.receive(timeout=0.01)
        assert result is None

    def test_receive_with_message(self, started_sharded_subscription: _RedisShardedSubscription):
        """Test receive method when message is available for sharded subscription."""
        test_message = b"test sharded receive"
        started_sharded_subscription._queue.put_nowait(test_message)

        result = started_sharded_subscription.receive(timeout=1.0)
        assert result == test_message


class TestRedisSubscriptionCommon:
    """Parameterized tests for common Redis subscription functionality.

    This test suite eliminates duplication by running the same tests against
    both regular and sharded subscriptions using pytest.mark.parametrize.
    """

    @pytest.fixture(
        params=[
            ("regular", _RedisSubscription),
            ("sharded", _RedisShardedSubscription),
        ]
    )
    def subscription_params(self, request):
        """Parameterized fixture providing subscription type and class."""
        return request.param

    @pytest.fixture
    def mock_pubsub(self) -> MagicMock:
        """Create a mock PubSub instance for testing."""
        pubsub = MagicMock()
        # Set up mock methods for both regular and sharded subscriptions
        pubsub.subscribe = MagicMock()
        pubsub.unsubscribe = MagicMock()
        pubsub.ssubscribe = MagicMock()  # type: ignore[attr-defined]
        pubsub.sunsubscribe = MagicMock()  # type: ignore[attr-defined]
        pubsub.get_message = MagicMock()
        pubsub.get_sharded_message = MagicMock()  # type: ignore[attr-defined]
        pubsub.close = MagicMock()
        return pubsub

    @pytest.fixture
    def subscription(self, subscription_params, mock_pubsub: MagicMock):
        """Create a subscription instance based on parameterized type."""
        subscription_type, subscription_class = subscription_params
        topic_name = f"test-{subscription_type}-topic"
        subscription = subscription_class(
            pubsub=mock_pubsub,
            topic=topic_name,
        )
        yield subscription
        subscription.close()

    @pytest.fixture
    def started_subscription(self, subscription):
        """Create a subscription that has been started."""
        subscription._start_if_needed()
        return subscription

    # ==================== Initialization Tests ====================

    def test_subscription_initialization(self, subscription, subscription_params):
        """Test that subscription is properly initialized."""
        subscription_type, _ = subscription_params
        expected_topic = f"test-{subscription_type}-topic"

        assert subscription._pubsub is not None
        assert subscription._topic == expected_topic
        assert not subscription._closed.is_set()
        assert subscription._dropped_count == 0
        assert subscription._listener_thread is None
        assert not subscription._started

    def test_subscription_type(self, subscription, subscription_params):
        """Test that subscription returns correct type."""
        subscription_type, _ = subscription_params
        assert subscription._get_subscription_type() == subscription_type

    # ==================== Lifecycle Tests ====================

    def test_start_if_needed_first_call(self, subscription, subscription_params, mock_pubsub: MagicMock):
        """Test that _start_if_needed() properly starts subscription on first call."""
        subscription_type, _ = subscription_params
        subscription._start_if_needed()

        if subscription_type == "regular":
            mock_pubsub.subscribe.assert_called_once()
        else:
            mock_pubsub.ssubscribe.assert_called_once()

        assert subscription._started is True
        assert subscription._listener_thread is not None

    def test_start_if_needed_subsequent_calls(self, started_subscription):
        """Test that _start_if_needed() doesn't start subscription on subsequent calls."""
        original_thread = started_subscription._listener_thread
        started_subscription._start_if_needed()

        # Should not create new thread
        assert started_subscription._listener_thread is original_thread

    def test_context_manager_usage(self, subscription, subscription_params, mock_pubsub: MagicMock):
        """Test that subscription works as context manager."""
        subscription_type, _ = subscription_params
        expected_topic = f"test-{subscription_type}-topic"

        with subscription as sub:
            assert sub is subscription
            assert subscription._started is True
            if subscription_type == "regular":
                mock_pubsub.subscribe.assert_called_with(expected_topic)
            else:
                mock_pubsub.ssubscribe.assert_called_with(expected_topic)

    def test_close_idempotent(self, subscription, subscription_params, mock_pubsub: MagicMock):
        """Test that close() is idempotent and can be called multiple times."""
        subscription_type, _ = subscription_params
        subscription._start_if_needed()

        # Close multiple times
        subscription.close()
        subscription.close()
        subscription.close()

        # Should only cleanup once
        if subscription_type == "regular":
            mock_pubsub.unsubscribe.assert_called_once()
        else:
            mock_pubsub.sunsubscribe.assert_called_once()
        mock_pubsub.close.assert_called_once()
        assert subscription._pubsub is None
        assert subscription._closed.is_set()

    # ==================== Message Processing Tests ====================

    def test_message_iterator_with_messages(self, started_subscription):
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

    def test_message_iterator_when_closed(self, subscription, subscription_params):
        """Test that iterator raises error when subscription is closed."""
        subscription_type, _ = subscription_params
        subscription.close()

        with pytest.raises(SubscriptionClosedError, match=f"The Redis {subscription_type} subscription is closed"):
            iter(subscription)

    # ==================== Message Enqueue Tests ====================

    def test_enqueue_message_success(self, started_subscription):
        """Test successful message enqueue."""
        payload = b"test message"

        started_subscription._enqueue_message(payload)

        assert started_subscription._queue.qsize() == 1
        assert started_subscription._queue.get_nowait() == payload

    def test_enqueue_message_when_closed(self, subscription):
        """Test message enqueue when subscription is closed."""
        subscription.close()
        payload = b"test message"

        # Should not raise exception, but should not enqueue
        subscription._enqueue_message(payload)

        assert subscription._queue.empty()

    def test_enqueue_message_with_full_queue(self, started_subscription):
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

    # ==================== Message Type Tests ====================

    def test_get_message_type(self, subscription, subscription_params):
        """Test that subscription returns correct message type."""
        subscription_type, _ = subscription_params
        expected_type = "message" if subscription_type == "regular" else "smessage"
        assert subscription._get_message_type() == expected_type

    # ==================== Error Handling Tests ====================

    def test_start_if_needed_when_closed(self, subscription, subscription_params):
        """Test that _start_if_needed() raises error when subscription is closed."""
        subscription_type, _ = subscription_params
        subscription.close()

        with pytest.raises(SubscriptionClosedError, match=f"The Redis {subscription_type} subscription is closed"):
            subscription._start_if_needed()

    def test_start_if_needed_when_cleaned_up(self, subscription, subscription_params):
        """Test that _start_if_needed() raises error when pubsub is None."""
        subscription_type, _ = subscription_params
        subscription._pubsub = None

        with pytest.raises(
            SubscriptionClosedError, match=f"The Redis {subscription_type} subscription has been cleaned up"
        ):
            subscription._start_if_needed()

    def test_iterator_after_close(self, subscription, subscription_params):
        """Test iterator behavior after close."""
        subscription_type, _ = subscription_params
        subscription.close()

        with pytest.raises(SubscriptionClosedError, match=f"The Redis {subscription_type} subscription is closed"):
            iter(subscription)

    def test_start_after_close(self, subscription, subscription_params):
        """Test start attempts after close."""
        subscription_type, _ = subscription_params
        subscription.close()

        with pytest.raises(SubscriptionClosedError, match=f"The Redis {subscription_type} subscription is closed"):
            subscription._start_if_needed()

    def test_pubsub_none_operations(self, subscription, subscription_params):
        """Test operations when pubsub is None."""
        subscription_type, _ = subscription_params
        subscription._pubsub = None

        with pytest.raises(
            SubscriptionClosedError, match=f"The Redis {subscription_type} subscription has been cleaned up"
        ):
            subscription._start_if_needed()

        # Close should still work
        subscription.close()  # Should not raise

    def test_receive_on_closed_subscription(self, subscription, subscription_params):
        """Test receive method on closed subscription."""
        subscription.close()

        with pytest.raises(SubscriptionClosedError):
            subscription.receive()

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
    def test_subscription_scenarios(
        self, test_case: SubscriptionTestCase, subscription, subscription_params, mock_pubsub: MagicMock
    ):
        """Test various subscription scenarios using table-driven approach."""
        subscription_type, _ = subscription_params
        expected_topic = f"test-{subscription_type}-topic"
        expected_message_type = "message" if subscription_type == "regular" else "smessage"

        # Simulate receiving message
        mock_message = {"type": expected_message_type, "channel": expected_topic, "data": test_case.payload}

        if subscription_type == "regular":
            mock_pubsub.get_message.return_value = mock_message
        else:
            mock_pubsub.get_sharded_message.return_value = mock_message

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

    # ==================== Concurrency Tests ====================

    def test_concurrent_close_and_enqueue(self, started_subscription):
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
