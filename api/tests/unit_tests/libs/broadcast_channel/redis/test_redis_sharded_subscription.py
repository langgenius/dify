"""redis sharded subscription tests."""

import threading
import time
from collections.abc import Generator
from unittest.mock import MagicMock, patch

import pytest

from libs.broadcast_channel.exc import SubscriptionClosedError
from libs.broadcast_channel.redis.sharded_channel import (
    _RedisShardedSubscription,
)
from tests.unit_tests.libs.broadcast_channel.redis._channel_test_helpers import FakeRedisClient, SubscriptionTestCase


class TestRedisShardedSubscription:
    """Test cases for the _RedisShardedSubscription class."""

    @pytest.fixture(autouse=True)
    def patch_sharded_redis_type(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr("libs.broadcast_channel.redis.sharded_channel.Redis", FakeRedisClient)

    @pytest.fixture
    def mock_redis_client(self) -> FakeRedisClient:
        return FakeRedisClient()

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
    def sharded_subscription(
        self, mock_pubsub: MagicMock, mock_redis_client: FakeRedisClient
    ) -> Generator[_RedisShardedSubscription, None, None]:
        """Create a _RedisShardedSubscription instance for testing."""
        subscription = _RedisShardedSubscription(
            client=mock_redis_client,
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

    def test_sharded_subscription_initialization(self, mock_pubsub: MagicMock, mock_redis_client: FakeRedisClient):
        """Test that sharded subscription is properly initialized."""
        subscription = _RedisShardedSubscription(
            client=mock_redis_client,
            pubsub=mock_pubsub,
            topic="test-sharded-topic",
        )

        assert subscription._client is mock_redis_client
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
        """Test that iterator stops when sharded subscription is closed."""
        sharded_subscription.close()

        assert list(sharded_subscription) == []

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

    @patch("time.sleep", side_effect=lambda x: None, autospec=True)  # Speed up test
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

    def test_get_message_uses_target_node_for_cluster_client(
        self, mock_pubsub: MagicMock, monkeypatch: pytest.MonkeyPatch
    ):
        """Test that cluster clients use target_node for sharded messages."""

        class DummyRedisCluster:
            def __init__(self):
                self.get_node_from_key = MagicMock(return_value="node-1")

        monkeypatch.setattr("libs.broadcast_channel.redis.sharded_channel.RedisCluster", DummyRedisCluster)

        client = DummyRedisCluster()
        subscription = _RedisShardedSubscription(
            client=client,
            pubsub=mock_pubsub,
            topic="test-sharded-topic",
        )
        mock_pubsub.get_sharded_message.return_value = {
            "type": "smessage",
            "channel": "test-sharded-topic",
            "data": b"payload",
        }

        result = subscription._get_message()

        client.get_node_from_key.assert_called_once_with("test-sharded-topic")
        mock_pubsub.get_sharded_message.assert_called_once_with(
            ignore_subscribe_messages=False,
            timeout=1,
            target_node="node-1",
        )
        assert result == mock_pubsub.get_sharded_message.return_value

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
    def test_sharded_subscription_scenarios(
        self, test_case: SubscriptionTestCase, mock_pubsub: MagicMock, mock_redis_client: FakeRedisClient
    ):
        """Test various sharded subscription scenarios using table-driven approach."""
        subscription = _RedisShardedSubscription(
            client=mock_redis_client,
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

        assert list(sharded_subscription) == []

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

    def test_channel_name_variations(self, mock_pubsub: MagicMock, mock_redis_client: FakeRedisClient):
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
                client=mock_redis_client,
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
