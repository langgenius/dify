"""redis subscription common tests."""

import threading
import time
from unittest.mock import MagicMock

import pytest

from libs.broadcast_channel.exc import SubscriptionClosedError
from libs.broadcast_channel.redis.pubsub_channel import _RedisSubscription
from libs.broadcast_channel.redis.sharded_channel import (
    _RedisShardedSubscription,
)
from libs.broadcast_channel.signals import SIG_CLOSE
from tests.unit_tests.libs.broadcast_channel.redis._channel_test_helpers import FakeRedisClient, SubscriptionTestCase


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
    def subscription(self, subscription_params, mock_pubsub: MagicMock, mock_redis_client: FakeRedisClient):
        """Create a subscription instance based on parameterized type."""
        subscription_type, subscription_class = subscription_params
        topic_name = f"test-{subscription_type}-topic"
        subscription = subscription_class(
            client=mock_redis_client,
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

    def test_listener_ignores_close_signal_from_another_subscription(self, subscription, subscription_params):
        subscription_type, _ = subscription_params
        topic = f"test-{subscription_type}-topic"
        message_type = "message" if subscription_type == "regular" else "smessage"
        messages = iter(
            [
                {"type": message_type, "channel": topic, "data": SIG_CLOSE},
                {"type": message_type, "channel": topic, "data": b"next-event"},
            ]
        )

        def get_message():
            try:
                return next(messages)
            except StopIteration:
                subscription._closed.set()
                return None

        subscription._get_message = get_message
        subscription._listen()

        assert subscription._queue.get_nowait() == b"next-event"
        assert subscription._queue.empty()

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
        """Test that iterator stops when subscription is closed."""
        subscription.close()

        assert list(subscription) == []

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
        subscription.close()

        assert list(subscription) == []

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
