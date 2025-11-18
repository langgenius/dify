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
from unittest.mock import MagicMock

import pytest

from libs.broadcast_channel.exc import BroadcastChannelError, SubscriptionClosedError
from libs.broadcast_channel.redis.channel import (
    BroadcastChannel as RedisBroadcastChannel,
)
from libs.broadcast_channel.redis.channel import (
    Topic,
    _get_redis_version,
    _RedisSubscription,
    _supports_sharded_pubsub,
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
        assert hasattr(topic, "_use_sharded_pubsub")

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
        return Topic(mock_redis_client, "test-topic", use_sharded_pubsub=False)

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

    def test_publish_calls_redis_publish_standard(self, topic: Topic, mock_redis_client: MagicMock):
        """Test that publish() calls Redis PUBLISH with correct parameters when sharded pub/sub is disabled."""
        payload = b"test message"
        topic.publish(payload)

        mock_redis_client.publish.assert_called_once_with("test-topic", payload)

    def test_publish_calls_redis_spublish_sharded(self, mock_redis_client: MagicMock):
        """Test that publish() calls Redis SPUBLISH when sharded pub/sub is enabled."""
        topic = Topic(mock_redis_client, "test-topic", use_sharded_pubsub=True)
        payload = b"test message"

        # Mock execute_command to simulate SPUBLISH support
        mock_redis_client.execute_command.return_value = 1
        topic.publish(payload)

        mock_redis_client.execute_command.assert_called_once_with("SPUBLISH", "test-topic", payload)
        mock_redis_client.publish.assert_not_called()

    def test_publish_fallback_to_standard_when_spublish_unsupported(self, mock_redis_client: MagicMock):
        """Test that publish() falls back to PUBLISH when SPUBLISH is not supported."""
        topic = Topic(mock_redis_client, "test-topic", use_sharded_pubsub=True)
        payload = b"test message"

        # Mock execute_command to raise "unknown command" error
        from redis.exceptions import RedisError

        mock_redis_client.execute_command.side_effect = RedisError("unknown command `SPUBLISH`")

        topic.publish(payload)

        # Should fallback to PUBLISH
        mock_redis_client.publish.assert_called_once_with("test-topic", payload)
        mock_redis_client.execute_command.assert_called_once_with("SPUBLISH", "test-topic", payload)


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
    def mock_redis_client_for_sub(self) -> MagicMock:
        """Create a mock Redis client for subscription testing."""
        client = MagicMock()
        pubsub = MagicMock()
        pubsub.subscribe = MagicMock()
        pubsub.unsubscribe = MagicMock()
        pubsub.close = MagicMock()
        pubsub.get_message = MagicMock()
        pubsub.execute_command = MagicMock()
        client.pubsub.return_value = pubsub
        return client

    @pytest.fixture
    def subscription(self, mock_redis_client_for_sub: MagicMock) -> Generator[_RedisSubscription, None, None]:
        """Create a _RedisSubscription instance for testing."""
        subscription = _RedisSubscription(
            redis_client=mock_redis_client_for_sub,
            topic="test-topic",
            use_sharded_pubsub=False,
        )
        yield subscription
        subscription.close()

    @pytest.fixture
    def started_subscription(self, subscription: _RedisSubscription) -> _RedisSubscription:
        """Create a subscription that has been started."""
        subscription._start_if_needed()
        return subscription

    # ==================== Lifecycle Tests ====================

    def test_subscription_initialization(self, mock_redis_client_for_sub: MagicMock):
        """Test that subscription is properly initialized."""
        subscription = _RedisSubscription(
            redis_client=mock_redis_client_for_sub,
            topic="test-topic",
            use_sharded_pubsub=False,
        )

        assert subscription._redis_client is mock_redis_client_for_sub
        assert subscription._topic == "test-topic"
        assert subscription._use_sharded_pubsub is False
        assert subscription._pubsub is None
        assert not subscription._closed.is_set()
        assert subscription._dropped_count == 0
        assert subscription._listener_thread is None
        assert not subscription._started
        assert subscription._subscription_mode is None

    def test_start_if_needed_first_call(self, subscription: _RedisSubscription, mock_redis_client_for_sub: MagicMock):
        """Test that _start_if_needed() properly starts subscription on first call."""
        subscription._start_if_needed()

        mock_redis_client_for_sub.pubsub.assert_called_once()
        pubsub_instance = mock_redis_client_for_sub.pubsub.return_value
        pubsub_instance.subscribe.assert_called_once_with("test-topic")
        assert subscription._started is True
        assert subscription._listener_thread is not None
        assert subscription._subscription_mode == "standard"

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
        """Test that _start_if_needed() works when pubsub is None initially."""
        # _pubsub should be None initially before starting
        assert subscription._pubsub is None

        # Starting should work fine and create the pubsub instance
        subscription._start_if_needed()

        # After starting, _pubsub should be created
        assert subscription._pubsub is not None

    def test_context_manager_usage(self, subscription: _RedisSubscription, mock_redis_client_for_sub: MagicMock):
        """Test that subscription works as context manager."""
        with subscription as sub:
            assert sub is subscription
            assert subscription._started is True
            # Verify that pubsub was called and subscribe was called
            mock_redis_client_for_sub.pubsub.assert_called_once()
            pubsub_instance = mock_redis_client_for_sub.pubsub.return_value
            pubsub_instance.subscribe.assert_called_once_with("test-topic")

    def test_close_idempotent(self, subscription: _RedisSubscription):
        """Test that close() is idempotent and can be called multiple times."""
        subscription._start_if_needed()

        # Close multiple times
        subscription.close()
        subscription.close()
        subscription.close()

        # Wait for listener thread to finish cleanup
        import time

        time.sleep(0.2)

        # Should be marked as closed
        assert subscription._closed.is_set()
        assert subscription._listener_thread is None

    def test_close_cleanup(self, subscription: _RedisSubscription):
        """Test that close() properly cleans up all resources."""
        subscription._start_if_needed()
        thread = subscription._listener_thread

        subscription.close()

        # Wait for listener thread to finish cleanup
        import time

        time.sleep(0.2)

        # Verify cleanup
        assert subscription._closed.is_set()
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

    def test_listener_thread_normal_operation(
        self, subscription: _RedisSubscription, mock_redis_client_for_sub: MagicMock
    ):
        """Test listener thread normal operation."""
        # Mock message from Redis
        mock_message = {"type": "message", "channel": "test-topic", "data": b"test payload"}
        pubsub_instance = mock_redis_client_for_sub.pubsub.return_value
        # Return None first (no message), then return our message
        pubsub_instance.get_message.side_effect = [None, mock_message, None]

        # Start listener
        subscription._start_if_needed()

        # Wait a bit for processing
        time.sleep(0.2)

        # Verify message was processed
        assert not subscription._queue.empty()
        assert subscription._queue.get_nowait() == b"test payload"

    def test_listener_thread_ignores_subscribe_messages(
        self, subscription: _RedisSubscription, mock_redis_client_for_sub: MagicMock
    ):
        """Test that listener thread ignores subscribe/unsubscribe messages."""
        mock_message = {"type": "subscribe", "channel": "test-topic", "data": 1}
        pubsub_instance = mock_redis_client_for_sub.pubsub.return_value
        # Return None first, then return subscribe message, then None again
        pubsub_instance.get_message.side_effect = [None, mock_message, None]

        subscription._start_if_needed()
        time.sleep(0.2)

        # Should not enqueue subscribe messages
        assert subscription._queue.empty()

    def test_listener_thread_ignores_wrong_channel(
        self, subscription: _RedisSubscription, mock_redis_client_for_sub: MagicMock
    ):
        """Test that listener thread ignores messages from wrong channels."""
        mock_message = {"type": "message", "channel": "wrong-topic", "data": b"test payload"}
        pubsub_instance = mock_redis_client_for_sub.pubsub.return_value
        # Return None first, then return wrong channel message, then None again
        pubsub_instance.get_message.side_effect = [None, mock_message, None]

        subscription._start_if_needed()
        time.sleep(0.2)

        # Should not enqueue messages from wrong channels
        assert subscription._queue.empty()

    def test_listener_thread_handles_redis_exceptions(
        self, subscription: _RedisSubscription, mock_redis_client_for_sub: MagicMock
    ):
        """Test that listener thread handles Redis exceptions gracefully."""
        pubsub_instance = mock_redis_client_for_sub.pubsub.return_value
        # Make get_message raise exception on second call after first call returns None
        pubsub_instance.get_message.side_effect = [None, Exception("Redis error")]

        subscription._start_if_needed()

        # Wait for thread to handle exception
        time.sleep(0.2)

        # Thread should be terminated due to exception
        assert subscription._listener_thread is not None
        # Thread should be dead due to unhandled exception
        assert not subscription._listener_thread.is_alive()

    def test_listener_thread_stops_when_closed(self, subscription: _RedisSubscription):
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
    def test_subscription_scenarios(self, test_case: SubscriptionTestCase, mock_redis_client_for_sub: MagicMock):
        """Test various subscription scenarios using table-driven approach."""
        subscription = _RedisSubscription(
            redis_client=mock_redis_client_for_sub,
            topic="test-topic",
            use_sharded_pubsub=False,
        )

        # Simulate receiving message
        pubsub_instance = mock_redis_client_for_sub.pubsub.return_value
        mock_message = {"type": "message", "channel": "test-topic", "data": test_case.payload}
        pubsub_instance.get_message.return_value = mock_message

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
        # Close the subscription first to set _closed event
        subscription.close()

        # After close, _pubsub should be None and _closed should be set
        assert subscription._pubsub is None

        # Now starting should raise SubscriptionClosedError
        with pytest.raises(SubscriptionClosedError, match="The Redis subscription is closed"):
            subscription._start_if_needed()

        # Close should still work (idempotent)
        subscription.close()  # Should not raise

    def test_channel_name_variations(self, mock_redis_client_for_sub: MagicMock):
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
                redis_client=mock_redis_client_for_sub,
                topic=channel_name,
                use_sharded_pubsub=False,
            )

            subscription._start_if_needed()
            pubsub_instance = mock_redis_client_for_sub.pubsub.return_value
            pubsub_instance.subscribe.assert_called_with(channel_name)
            subscription.close()

    def test_received_on_closed_subscription(self, subscription: _RedisSubscription):
        subscription.close()

        with pytest.raises(SubscriptionClosedError, match="The Redis subscription is closed"):
            subscription.receive()

    # ==================== SSUBSCRIBE Tests ====================

    def test_ssubscribe_when_sharded_enabled(self, mock_redis_client_for_sub: MagicMock):
        """Test SSUBSCRIBE is used when sharded pub/sub is enabled."""
        subscription = _RedisSubscription(
            redis_client=mock_redis_client_for_sub,
            topic="test-topic",
            use_sharded_pubsub=True,
        )

        subscription._start_if_needed()

        # Verify SSUBSCRIBE was called
        pubsub_instance = mock_redis_client_for_sub.pubsub.return_value
        pubsub_instance.execute_command.assert_called_once_with("SSUBSCRIBE", "test-topic")
        assert subscription._subscription_mode == "sharded"

    def test_ssubscribe_fallback_to_subscribe_when_unsupported(self, mock_redis_client_for_sub: MagicMock):
        """Test fallback to SUBSCRIBE when SSUBSCRIBE is not supported."""
        from redis.exceptions import RedisError

        subscription = _RedisSubscription(
            redis_client=mock_redis_client_for_sub,
            topic="test-topic",
            use_sharded_pubsub=True,
        )

        # Mock SSUBSCRIBE to fail with unknown command error
        pubsub_instance = mock_redis_client_for_sub.pubsub.return_value
        pubsub_instance.execute_command.side_effect = RedisError("unknown command `SSUBSCRIBE`")

        subscription._start_if_needed()

        # Should fallback to SUBSCRIBE
        assert pubsub_instance.subscribe.called
        assert subscription._subscription_mode == "standard"

    def test_unsubscribe_calls_correct_command(self, mock_redis_client_for_sub: MagicMock):
        """Test that correct UNSUBSCRIBE command is called based on mode."""
        # Test sharded mode
        sharded_subscription = _RedisSubscription(
            redis_client=mock_redis_client_for_sub,
            topic="test-topic",
            use_sharded_pubsub=True,
        )
        sharded_subscription._start_if_needed()
        sharded_subscription.close()

        pubsub_instance = mock_redis_client_for_sub.pubsub.return_value
        pubsub_instance.execute_command.assert_called_with("SUNSUBSCRIBE", "test-topic")

        # Reset mock
        pubsub_instance.reset_mock()

        # Test standard mode
        standard_subscription = _RedisSubscription(
            redis_client=mock_redis_client_for_sub,
            topic="test-topic",
            use_sharded_pubsub=False,
        )
        standard_subscription._start_if_needed()
        standard_subscription.close()

        pubsub_instance.unsubscribe.assert_called_with("test-topic")

    def test_listener_handles_sharded_messages(self, mock_redis_client_for_sub: MagicMock):
        """Test that listener handles sharded message types ('smessage')."""
        subscription = _RedisSubscription(
            redis_client=mock_redis_client_for_sub,
            topic="test-topic",
            use_sharded_pubsub=True,
        )

        # Mock sharded message
        pubsub_instance = mock_redis_client_for_sub.pubsub.return_value
        mock_message = {"type": "smessage", "channel": "test-topic", "data": b"sharded payload"}
        pubsub_instance.get_message.return_value = mock_message

        subscription._start_if_needed()
        time.sleep(0.1)

        assert not subscription._queue.empty()
        assert subscription._queue.get_nowait() == b"sharded payload"

    def test_listener_ignores_invalid_message_types(self, mock_redis_client_for_sub: MagicMock):
        """Test that listener ignores invalid message types."""
        subscription = _RedisSubscription(
            redis_client=mock_redis_client_for_sub,
            topic="test-topic",
            use_sharded_pubsub=True,
        )

        # Mock invalid message type
        pubsub_instance = mock_redis_client_for_sub.pubsub.return_value
        mock_message = {"type": "invalid_type", "channel": "test-topic", "data": b"payload"}
        pubsub_instance.get_message.return_value = mock_message

        subscription._start_if_needed()
        time.sleep(0.1)

        # Should not enqueue invalid message types
        assert subscription._queue.empty()


class TestRedisVersionDetection:
    """Test cases for Redis version detection utilities."""

    def test_get_redis_version_success(self):
        """Test successful Redis version parsing."""
        mock_redis = MagicMock()
        mock_redis.info.return_value = {"redis_version": "7.2.3"}

        version = _get_redis_version(mock_redis)
        assert version == (7, 2, 3)

    def test_get_redis_version_with_prerelease(self):
        """Test Redis version parsing with prerelease suffix."""
        mock_redis = MagicMock()
        mock_redis.info.return_value = {"redis_version": "7.0.0-rc1"}

        version = _get_redis_version(mock_redis)
        assert version == (7, 0, 0)

    def test_get_redis_version_missing_info(self):
        """Test Redis version parsing when info is missing."""
        mock_redis = MagicMock()
        mock_redis.info.return_value = {}

        version = _get_redis_version(mock_redis)
        assert version == (0, 0, 0)

    def test_get_redis_version_redis_error(self):
        """Test Redis version parsing when Redis raises an error."""
        from redis.exceptions import RedisError

        mock_redis = MagicMock()
        mock_redis.info.side_effect = RedisError("Connection failed")

        version = _get_redis_version(mock_redis)
        assert version == (0, 0, 0)

    def test_supports_sharded_pubsub_redis_7(self):
        """Test sharded pub/sub support detection for Redis 7."""
        mock_redis = MagicMock()
        mock_redis.info.return_value = {"redis_version": "7.0.0"}

        assert _supports_sharded_pubsub(mock_redis) is True

    def test_supports_sharded_pubsub_redis_6(self):
        """Test sharded pub/sub support detection for Redis 6."""
        mock_redis = MagicMock()
        mock_redis.info.return_value = {"redis_version": "6.2.0"}

        assert _supports_sharded_pubsub(mock_redis) is False

    def test_supports_sharded_pubsub_with_cached_version(self):
        """Test sharded pub/sub support detection with pre-cached version."""
        mock_redis = MagicMock()

        # Test with Redis 7 version
        assert _supports_sharded_pubsub(mock_redis, (7, 1, 0)) is True

        # Test with Redis 6 version
        assert _supports_sharded_pubsub(mock_redis, (6, 2, 0)) is False

        # Should not call info() when version is provided
        mock_redis.info.assert_not_called()

    def test_supports_sharded_pubsub_version_detection_failure(self):
        """Test sharded pub/sub support detection when version detection fails."""
        from redis.exceptions import RedisError

        mock_redis = MagicMock()
        mock_redis.info.side_effect = RedisError("Info command failed")

        assert _supports_sharded_pubsub(mock_redis) is False


class TestBroadcastChannelWithShardedPubSub:
    """Test cases for BroadcastChannel with sharded pub/sub."""

    def test_broadcast_channel_auto_detects_sharded_support(self):
        """Test that BroadcastChannel automatically detects sharded pub/sub support."""
        mock_redis = MagicMock()
        mock_redis.info.return_value = {"redis_version": "7.1.0"}

        channel = RedisBroadcastChannel(mock_redis)

        assert channel._use_sharded_pubsub is True

    def test_broadcast_channel_force_disable_sharded(self):
        """Test forcing sharded pub/sub to be disabled."""
        mock_redis = MagicMock()
        mock_redis.info.return_value = {"redis_version": "7.1.0"}

        channel = RedisBroadcastChannel(mock_redis, use_sharded_pubsub=False)

        assert channel._use_sharded_pubsub is False

    def test_broadcast_channel_force_enable_sharded(self):
        """Test forcing sharded pub/sub to be enabled."""
        mock_redis = MagicMock()
        mock_redis.info.return_value = {"redis_version": "6.2.0"}

        channel = RedisBroadcastChannel(mock_redis, use_sharded_pubsub=True)

        assert channel._use_sharded_pubsub is True

    def test_topic_receives_sharded_setting(self):
        """Test that Topic receives sharded pub/sub setting from BroadcastChannel."""
        mock_redis = MagicMock()
        mock_redis.info.return_value = {"redis_version": "7.0.0"}

        channel = RedisBroadcastChannel(mock_redis)
        topic = channel.topic("test-topic")

        assert topic._use_sharded_pubsub is True

    def test_subscription_receives_sharded_setting(self):
        """Test that _RedisSubscription receives sharded pub/sub setting from Topic."""
        mock_redis = MagicMock()
        mock_redis.info.return_value = {"redis_version": "7.0.0"}

        channel = RedisBroadcastChannel(mock_redis)
        topic = channel.topic("test-topic")
        subscription = topic.subscribe()

        assert subscription._use_sharded_pubsub is True

    def test_version_caching_prevents_duplicate_info_calls(self):
        """Test that version caching prevents duplicate Redis INFO calls."""
        mock_redis = MagicMock()
        mock_redis.info.return_value = {"redis_version": "7.1.0"}

        channel = RedisBroadcastChannel(mock_redis)

        # Should only call info() once during initialization
        mock_redis.info.assert_called_once()

        # Verify version is cached
        assert channel._redis_version == (7, 1, 0)
        assert channel._use_sharded_pubsub is True
