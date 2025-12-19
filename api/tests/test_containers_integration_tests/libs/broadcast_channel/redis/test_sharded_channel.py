"""
Integration tests for Redis sharded broadcast channel implementation using TestContainers.

Covers real Redis 7+ sharded pub/sub interactions including:
- Multiple producer/consumer scenarios
- Topic isolation
- Concurrency under load
- Resource cleanup accounting via PUBSUB SHARDNUMSUB
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
from libs.broadcast_channel.redis.sharded_channel import (
    ShardedRedisBroadcastChannel,
)


class TestShardedRedisBroadcastChannelIntegration:
    """Integration tests for Redis sharded broadcast channel with real Redis 7 instance."""

    @pytest.fixture(scope="class")
    def redis_container(self) -> Iterator[RedisContainer]:
        """Create a Redis 7 container for integration testing (required for sharded pub/sub)."""
        # Redis 7+ is required for SPUBLISH/SSUBSCRIBE
        with RedisContainer(image="redis:7-alpine") as container:
            yield container

    @pytest.fixture(scope="class")
    def redis_client(self, redis_container: RedisContainer) -> redis.Redis:
        """Create a Redis client connected to the test container."""
        host = redis_container.get_container_host_ip()
        port = redis_container.get_exposed_port(6379)
        return redis.Redis(host=host, port=port, decode_responses=False)

    @pytest.fixture
    def broadcast_channel(self, redis_client: redis.Redis) -> BroadcastChannel:
        """Create a ShardedRedisBroadcastChannel instance with real Redis client."""
        return ShardedRedisBroadcastChannel(redis_client)

    @classmethod
    def _get_test_topic_name(cls) -> str:
        return f"test_sharded_topic_{uuid.uuid4()}"

    # ==================== Basic Functionality Tests ====================

    def test_close_an_active_subscription_should_stop_iteration(self, broadcast_channel: BroadcastChannel):
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
            consumer_future = executor.submit(consume)
            consuming_event.wait()
            subscription.close()
            msgs = consumer_future.result(timeout=2)
        assert msgs == []

    def test_end_to_end_messaging(self, broadcast_channel: BroadcastChannel):
        """Test complete end-to-end messaging flow (sharded)."""
        topic_name = self._get_test_topic_name()
        message = b"hello sharded world"

        topic = broadcast_channel.topic(topic_name)
        producer = topic.as_producer()
        subscription = topic.subscribe()

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

        with ThreadPoolExecutor(max_workers=2) as executor:
            producer_future = executor.submit(producer_thread)
            consumer_future = executor.submit(consumer_thread)

            producer_future.result(timeout=5.0)
            received_messages = consumer_future.result(timeout=5.0)

        assert len(received_messages) == 1
        assert received_messages[0] == message

    def test_multiple_subscribers_same_topic(self, broadcast_channel: BroadcastChannel):
        """Test message broadcasting to multiple sharded subscribers."""
        topic_name = self._get_test_topic_name()
        message = b"broadcast sharded message"
        subscriber_count = 5

        topic = broadcast_channel.topic(topic_name)
        producer = topic.as_producer()
        subscriptions = [topic.subscribe() for _ in range(subscriber_count)]
        ready_events = [threading.Event() for _ in range(subscriber_count)]

        def producer_thread():
            deadline = time.time() + 5.0
            for ev in ready_events:
                remaining = deadline - time.time()
                if remaining <= 0:
                    break
                if not ev.wait(timeout=max(0.0, remaining)):
                    pytest.fail("subscriber did not become ready before publish deadline")
            producer.publish(message)
            time.sleep(0.2)
            for sub in subscriptions:
                sub.close()

        def consumer_thread(subscription: Subscription, ready_event: threading.Event) -> list[bytes]:
            received_msgs = []
            # Prime subscription so the underlying Pub/Sub listener thread starts before publishing
            try:
                _ = subscription.receive(0.01)
            except SubscriptionClosedError:
                return received_msgs
            finally:
                ready_event.set()

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

        with ThreadPoolExecutor(max_workers=subscriber_count + 1) as executor:
            producer_future = executor.submit(producer_thread)
            consumer_futures = [
                executor.submit(consumer_thread, subscription, ready_events[idx])
                for idx, subscription in enumerate(subscriptions)
            ]

            producer_future.result(timeout=10.0)
            msgs_by_consumers = []
            for future in as_completed(consumer_futures, timeout=10.0):
                msgs_by_consumers.append(future.result())

        for subscription in subscriptions:
            subscription.close()

        for msgs in msgs_by_consumers:
            assert len(msgs) == 1
            assert msgs[0] == message

    def test_topic_isolation(self, broadcast_channel: BroadcastChannel):
        """Test that different sharded topics are isolated from each other."""
        topic1_name = self._get_test_topic_name()
        topic2_name = self._get_test_topic_name()
        message1 = b"message for sharded topic1"
        message2 = b"message for sharded topic2"

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

        with ThreadPoolExecutor(max_workers=3) as executor:
            producer_future = executor.submit(producer_thread)
            consumer1_future = executor.submit(consumer_by_thread, topic1)
            consumer2_future = executor.submit(consumer_by_thread, topic2)

            producer_future.result(timeout=5.0)
            received_by_topic1 = consumer1_future.result(timeout=5.0)
            received_by_topic2 = consumer2_future.result(timeout=5.0)

        assert len(received_by_topic1) == 1
        assert len(received_by_topic2) == 1
        assert received_by_topic1[0] == message1
        assert received_by_topic2[0] == message2

    # ==================== Performance / Concurrency ====================

    def test_concurrent_producers(self, broadcast_channel: BroadcastChannel):
        """Test multiple producers publishing to the same sharded topic."""
        topic_name = self._get_test_topic_name()
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
                time.sleep(0.001)
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

        with ThreadPoolExecutor(max_workers=producer_count + 1) as executor:
            consumer_future = executor.submit(consumer_thread)
            consumer_ready.wait()
            producer_futures = [executor.submit(producer_thread, i) for i in range(producer_count)]

            sent_msgs: set[bytes] = set()
            for future in as_completed(producer_futures, timeout=30.0):
                sent_msgs.update(future.result())

            consumer_received_msgs = consumer_future.result(timeout=60.0)

        assert sent_msgs == consumer_received_msgs

    # ==================== Resource Management ====================

    def _get_sharded_numsub(self, redis_client: redis.Redis, topic_name: str) -> int:
        """Return number of sharded subscribers for a given topic using PUBSUB SHARDNUMSUB.

        Redis returns a flat list like [channel1, count1, channel2, count2, ...].
        We request a single channel, so parse accordingly.
        """
        try:
            res = redis_client.execute_command("PUBSUB", "SHARDNUMSUB", topic_name)
        except Exception:
            return 0
        # Normalize different possible return shapes from drivers
        if isinstance(res, (list, tuple)):
            # Expect [channel, count] (bytes/str, int)
            if len(res) >= 2:
                key = res[0]
                cnt = res[1]
                if key == topic_name or (isinstance(key, (bytes, bytearray)) and key == topic_name.encode()):
                    try:
                        return int(cnt)
                    except Exception:
                        return 0
            # Fallback parse pairs
            count = 0
            for i in range(0, len(res) - 1, 2):
                key = res[i]
                cnt = res[i + 1]
                if key == topic_name or (isinstance(key, (bytes, bytearray)) and key == topic_name.encode()):
                    try:
                        count = int(cnt)
                    except Exception:
                        count = 0
                    break
            return count
        return 0

    def test_subscription_cleanup(self, broadcast_channel: BroadcastChannel, redis_client: redis.Redis):
        """Test proper cleanup of sharded subscription resources via SHARDNUMSUB."""
        topic_name = self._get_test_topic_name()

        topic = broadcast_channel.topic(topic_name)

        def _consume(sub: Subscription):
            for _ in sub:
                pass

        subscriptions = []
        for _ in range(5):
            subscription = topic.subscribe()
            subscriptions.append(subscription)

            thread = threading.Thread(target=_consume, args=(subscription,))
            thread.start()
            time.sleep(0.01)

        # Verify subscriptions are active using SHARDNUMSUB
        topic_subscribers = self._get_sharded_numsub(redis_client, topic_name)
        assert topic_subscribers >= 5

        # Close all subscriptions
        for subscription in subscriptions:
            subscription.close()

        # Wait a bit for cleanup
        time.sleep(1)

        # Verify subscriptions are cleaned up
        topic_subscribers_after = self._get_sharded_numsub(redis_client, topic_name)
        assert topic_subscribers_after == 0
