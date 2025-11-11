"""
Integration tests for Redis broadcast channel implementation using TestContainers.

This test suite covers real Redis interactions including:
- Multiple producer/consumer scenarios
- Network failure scenarios
- Performance under load
- Real-world usage patterns
"""

import threading
import time
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed

import pytest
import redis
from testcontainers.redis import RedisContainer

from libs.broadcast_channel.channel import BroadcastChannel, Subscription, Topic
from libs.broadcast_channel.exc import SubscriptionClosedError
from libs.broadcast_channel.redis.channel import BroadcastChannel as RedisBroadcastChannel


class TestRedisBroadcastChannelIntegration:
    """Integration tests for Redis broadcast channel with real Redis instance."""

    @pytest.fixture(scope="class")
    def redis_container(self) -> Iterator[RedisContainer]:
        """Create a Redis container for integration testing."""
        with RedisContainer(image="redis:6-alpine") as container:
            yield container

    @pytest.fixture(scope="class")
    def redis_client(self, redis_container: RedisContainer) -> redis.Redis:
        """Create a Redis client connected to the test container."""
        host = redis_container.get_container_host_ip()
        port = redis_container.get_exposed_port(6379)
        return redis.Redis(host=host, port=port, decode_responses=False)

    @pytest.fixture
    def broadcast_channel(self, redis_client: redis.Redis) -> BroadcastChannel:
        """Create a BroadcastChannel instance with real Redis client."""
        return RedisBroadcastChannel(redis_client)

    @classmethod
    def _get_test_topic_name(cls):
        return f"test_topic_{uuid.uuid4()}"

    # ==================== Basic Functionality Tests ===================='

    def test_close_an_active_subscription_should_stop_iteration(self, broadcast_channel):
        topic_name = self._get_test_topic_name()
        topic = broadcast_channel.topic(topic_name)
        subscription = topic.subscribe()
        consuming_event = threading.Event()

        def consume():
            msgs = []
            consuming_event.set()
            for msg in subscription:
                msgs.append(msg)
            return msgs

        with ThreadPoolExecutor(max_workers=1) as executor:
            producer_future = executor.submit(consume)
            consuming_event.wait()
            subscription.close()
            msgs = producer_future.result(timeout=1)
        assert msgs == []

    def test_end_to_end_messaging(self, broadcast_channel: BroadcastChannel):
        """Test complete end-to-end messaging flow."""
        topic_name = "test-topic"
        message = b"hello world"

        # Create producer and subscriber
        topic = broadcast_channel.topic(topic_name)
        producer = topic.as_producer()
        subscription = topic.subscribe()

        # Publish and receive message

        def producer_thread():
            time.sleep(0.1)  # Small delay to ensure subscriber is ready
            producer.publish(message)
            time.sleep(0.1)
            subscription.close()

        def consumer_thread() -> list[bytes]:
            received_messages = []
            for msg in subscription:
                received_messages.append(msg)
            return received_messages

        # Run producer and consumer
        with ThreadPoolExecutor(max_workers=2) as executor:
            producer_future = executor.submit(producer_thread)
            consumer_future = executor.submit(consumer_thread)

            # Wait for completion
            producer_future.result(timeout=5.0)
            received_messages = consumer_future.result(timeout=5.0)

        assert len(received_messages) == 1
        assert received_messages[0] == message

    def test_multiple_subscribers_same_topic(self, broadcast_channel: BroadcastChannel):
        """Test message broadcasting to multiple subscribers."""
        topic_name = "broadcast-topic"
        message = b"broadcast message"
        subscriber_count = 5

        # Create producer and multiple subscribers
        topic = broadcast_channel.topic(topic_name)
        producer = topic.as_producer()
        subscriptions = [topic.subscribe() for _ in range(subscriber_count)]

        def producer_thread():
            time.sleep(0.2)  # Allow all subscribers to connect
            producer.publish(message)
            time.sleep(0.2)
            for sub in subscriptions:
                sub.close()

        def consumer_thread(subscription: Subscription) -> list[bytes]:
            received_msgs = []
            while True:
                try:
                    msg = subscription.receive(0.1)
                except SubscriptionClosedError:
                    break
                if msg is None:
                    continue
                received_msgs.append(msg)
                if len(received_msgs) >= 1:
                    break
            return received_msgs

        # Run producer and consumers
        with ThreadPoolExecutor(max_workers=subscriber_count + 1) as executor:
            producer_future = executor.submit(producer_thread)
            consumer_futures = [executor.submit(consumer_thread, subscription) for subscription in subscriptions]

            # Wait for completion
            producer_future.result(timeout=10.0)
            msgs_by_consumers = []
            for future in as_completed(consumer_futures, timeout=10.0):
                msgs_by_consumers.append(future.result())

        # Close all subscriptions
        for subscription in subscriptions:
            subscription.close()

        # Verify all subscribers received the message
        for msgs in msgs_by_consumers:
            assert len(msgs) == 1
            assert msgs[0] == message

    def test_topic_isolation(self, broadcast_channel: BroadcastChannel):
        """Test that different topics are isolated from each other."""
        topic1_name = "topic1"
        topic2_name = "topic2"
        message1 = b"message for topic1"
        message2 = b"message for topic2"

        # Create producers and subscribers for different topics
        topic1 = broadcast_channel.topic(topic1_name)
        topic2 = broadcast_channel.topic(topic2_name)

        def producer_thread():
            time.sleep(0.1)
            topic1.publish(message1)
            topic2.publish(message2)

        def consumer_by_thread(topic: Topic) -> list[bytes]:
            subscription = topic.subscribe()
            received = []
            with subscription:
                for msg in subscription:
                    received.append(msg)
                    if len(received) >= 1:
                        break
            return received

        # Run all threads
        with ThreadPoolExecutor(max_workers=3) as executor:
            producer_future = executor.submit(producer_thread)
            consumer1_future = executor.submit(consumer_by_thread, topic1)
            consumer2_future = executor.submit(consumer_by_thread, topic2)

            # Wait for completion
            producer_future.result(timeout=5.0)
            received_by_topic1 = consumer1_future.result(timeout=5.0)
            received_by_topic2 = consumer2_future.result(timeout=5.0)

        # Verify topic isolation
        assert len(received_by_topic1) == 1
        assert len(received_by_topic2) == 1
        assert received_by_topic1[0] == message1
        assert received_by_topic2[0] == message2

    # ==================== Performance Tests ====================

    def test_concurrent_producers(self, broadcast_channel: BroadcastChannel):
        """Test multiple producers publishing to the same topic."""
        topic_name = "concurrent-producers-topic"
        producer_count = 5
        messages_per_producer = 5

        topic = broadcast_channel.topic(topic_name)
        subscription = topic.subscribe()

        expected_total = producer_count * messages_per_producer
        consumer_ready = threading.Event()

        def producer_thread(producer_idx: int) -> set[bytes]:
            producer = topic.as_producer()
            produced = set()
            for i in range(messages_per_producer):
                message = f"producer_{producer_idx}_msg_{i}".encode()
                produced.add(message)
                producer.publish(message)
                time.sleep(0.001)  # Small delay to avoid overwhelming
            return produced

        def consumer_thread() -> set[bytes]:
            received_msgs: set[bytes] = set()
            with subscription:
                consumer_ready.set()
                while True:
                    try:
                        msg = subscription.receive(timeout=0.1)
                    except SubscriptionClosedError:
                        break
                    if msg is None:
                        if len(received_msgs) >= expected_total:
                            break
                        else:
                            continue

                    received_msgs.add(msg)
            return received_msgs

        # Run producers and consumer
        with ThreadPoolExecutor(max_workers=producer_count + 1) as executor:
            consumer_future = executor.submit(consumer_thread)
            consumer_ready.wait()
            producer_futures = [executor.submit(producer_thread, i) for i in range(producer_count)]

            sent_msgs: set[bytes] = set()
            # Wait for completion
            for future in as_completed(producer_futures, timeout=30.0):
                sent_msgs.update(future.result())

            subscription.close()
            consumer_received_msgs = consumer_future.result(timeout=30.0)

        # Verify message content
        assert sent_msgs == consumer_received_msgs

    # ==================== Resource Management Tests ====================

    def test_subscription_cleanup(self, broadcast_channel: BroadcastChannel, redis_client: redis.Redis):
        """Test proper cleanup of subscription resources."""
        topic_name = "cleanup-test-topic"

        # Create multiple subscriptions
        topic = broadcast_channel.topic(topic_name)

        def _consume(sub: Subscription):
            for i in sub:
                pass

        subscriptions = []
        for i in range(5):
            subscription = topic.subscribe()
            subscriptions.append(subscription)

            # Start all subscriptions
            thread = threading.Thread(target=_consume, args=(subscription,))
            thread.start()
            time.sleep(0.01)

        # Verify subscriptions are active
        pubsub_info = redis_client.pubsub_numsub(topic_name)
        # pubsub_numsub returns list of tuples, find our topic
        topic_subscribers = 0
        for channel, count in pubsub_info:
            # the channel name returned by redis is bytes.
            if channel == topic_name.encode():
                topic_subscribers = count
                break
        assert topic_subscribers >= 5

        # Close all subscriptions
        for subscription in subscriptions:
            subscription.close()

        # Wait a bit for cleanup
        time.sleep(1)

        # Verify subscriptions are cleaned up
        pubsub_info_after = redis_client.pubsub_numsub(topic_name)
        topic_subscribers_after = 0
        for channel, count in pubsub_info_after:
            if channel == topic_name.encode():
                topic_subscribers_after = count
                break
        assert topic_subscribers_after == 0
