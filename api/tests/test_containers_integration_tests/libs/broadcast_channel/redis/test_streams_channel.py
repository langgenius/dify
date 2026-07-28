"""
Integration tests for Redis Streams broadcast channel implementation using TestContainers.

This suite focuses on the semantics that differ from Redis Pub/Sub:
- Every active subscription should receive each newly published message.
- Late subscriptions replay retained messages and may resume after an explicit cursor.
"""

import json
import re
import threading
import time
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import cast

import pytest
import redis
from testcontainers.redis import RedisContainer

from core.app.apps.base_app_generator import BaseAppGenerator
from core.app.apps.streaming_utils import stream_topic_events
from core.app.entities.task_entities import StreamEvent
from libs.broadcast_channel.channel import BroadcastChannel, CursorSubscription, Subscription, Topic
from libs.broadcast_channel.exc import SubscriptionClosedError
from libs.broadcast_channel.redis.streams_channel import StreamsBroadcastChannel, StreamsTopic
from libs.broadcast_channel.signals import SIG_CLOSE


class TestRedisStreamsBroadcastChannelIntegration:
    """Integration tests for Redis Streams broadcast channel with a real Redis instance."""

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
        """Create a StreamsBroadcastChannel instance with a real Redis client."""
        return StreamsBroadcastChannel(redis_client)

    @classmethod
    def _get_test_topic_name(cls) -> str:
        return f"test_streams_topic_{uuid.uuid4()}"

    @staticmethod
    def _start_subscription(subscription: Subscription) -> None:
        """Start the background listener and confirm the subscription queue is empty."""
        assert subscription.receive(timeout=0.05) is None

    @staticmethod
    def _receive_message(subscription: Subscription, *, timeout_seconds: float = 2.0) -> bytes:
        """Poll until a message is received or the timeout expires."""
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            message = subscription.receive(timeout=0.1)
            if message is not None:
                return message
        pytest.fail("Timed out waiting for a message")

    def test_close_an_active_subscription_should_stop_iteration(self, broadcast_channel: BroadcastChannel) -> None:
        """Closing an active subscription should terminate the iterator cleanly."""
        topic = broadcast_channel.topic(self._get_test_topic_name())
        subscription = topic.subscribe()
        consuming_event = threading.Event()

        def consume() -> list[bytes]:
            messages: list[bytes] = []
            consuming_event.set()
            for message in subscription:
                messages.append(message)
            return messages

        with ThreadPoolExecutor(max_workers=1) as executor:
            consumer_future = executor.submit(consume)
            assert consuming_event.wait(timeout=1.0)
            subscription.close()
            assert consumer_future.result(timeout=2.0) == []

    def test_end_to_end_messaging(self, broadcast_channel: BroadcastChannel) -> None:
        """A producer should publish a message that a live subscription can consume."""
        topic = broadcast_channel.topic(self._get_test_topic_name())
        producer = topic.as_producer()
        subscription = topic.subscribe()
        message = b"hello streams"

        try:
            self._start_subscription(subscription)
            producer.publish(message)

            assert self._receive_message(subscription) == message
            assert subscription.receive(timeout=0.1) is None
        finally:
            subscription.close()

    def test_publish_sets_stream_retention_atomically(self, redis_client: redis.Redis) -> None:
        topic = StreamsBroadcastChannel(redis_client, retention_seconds=60).topic(self._get_test_topic_name())

        topic.publish(b"retained")

        ttl = redis_client.ttl(topic._key)
        assert 0 < ttl <= 60

    def test_multiple_subscriptions_each_receive_each_new_message(self, broadcast_channel: BroadcastChannel) -> None:
        """Each active subscription should receive the same newly published message."""
        topic = broadcast_channel.topic(self._get_test_topic_name())
        subscriptions = [topic.subscribe() for _ in range(3)]
        new_message = b"message-visible-to-every-subscriber"

        try:
            for subscription in subscriptions:
                self._start_subscription(subscription)

            topic.publish(new_message)

            for subscription in subscriptions:
                assert self._receive_message(subscription) == new_message
                assert subscription.receive(timeout=0.1) is None
        finally:
            for subscription in subscriptions:
                subscription.close()

    def test_each_subscription_replays_retained_messages_in_order(
        self,
        broadcast_channel: BroadcastChannel,
    ) -> None:
        """A late subscription should replay every retained message in stream order."""
        topic = broadcast_channel.topic(self._get_test_topic_name())
        first_subscription = topic.subscribe()
        second_subscription = topic.subscribe()
        message_before_any_subscription = b"before-any-subscription"
        message_after_first_subscription = b"after-first-subscription"
        message_after_second_subscription = b"after-second-subscription"

        try:
            topic.publish(message_before_any_subscription)

            assert self._receive_message(first_subscription) == message_before_any_subscription
            topic.publish(message_after_first_subscription)

            assert self._receive_message(first_subscription) == message_after_first_subscription
            assert first_subscription.receive(timeout=0.1) is None

            assert self._receive_message(second_subscription) == message_before_any_subscription
            assert self._receive_message(second_subscription) == message_after_first_subscription
            topic.publish(message_after_second_subscription)

            assert self._receive_message(first_subscription) == message_after_second_subscription
            assert self._receive_message(second_subscription) == message_after_second_subscription
            assert first_subscription.receive(timeout=0.1) is None
            assert second_subscription.receive(timeout=0.1) is None
        finally:
            first_subscription.close()
            second_subscription.close()

    def test_reconnect_cursor_replays_strictly_after_last_event_id(self, broadcast_channel: BroadcastChannel) -> None:
        topic = broadcast_channel.topic(self._get_test_topic_name())
        topic.publish(b"one")
        topic.publish(b"two")
        topic.publish(b"three")

        first = topic.subscribe()
        try:
            first_message = cast(CursorSubscription, first).receive_with_cursor(timeout=1)
            assert first_message is not None
            assert first_message.payload == b"one"
        finally:
            first.close()

        resumed = topic.subscribe(cursor=first_message.cursor)
        try:
            assert self._receive_message(resumed) == b"two"
            assert self._receive_message(resumed) == b"three"
            assert resumed.receive(timeout=0.1) is None
        finally:
            resumed.close()

    def test_real_stream_cursor_is_rendered_as_standard_sse_id(self, broadcast_channel: BroadcastChannel) -> None:
        topic = broadcast_channel.topic(self._get_test_topic_name())
        topic.publish(json.dumps({"event": StreamEvent.WORKFLOW_FINISHED.value}).encode())

        chunks = list(
            BaseAppGenerator.convert_to_event_stream(
                stream_topic_events(topic=topic, idle_timeout=1, cursor="0-0"),
            )
        )

        assert chunks[0] == "event: ping\n\n"
        assert re.fullmatch(r'id: [0-9]+-[0-9]+\ndata: \{"event":"workflow_finished"\}\n\n', chunks[1])

    def test_closing_one_subscription_is_local_and_does_not_append_marker(
        self,
        broadcast_channel: BroadcastChannel,
        redis_client: redis.Redis,
    ) -> None:
        topic = broadcast_channel.topic(self._get_test_topic_name())
        assert isinstance(topic, StreamsTopic)
        first = topic.subscribe()
        second = topic.subscribe()

        self._start_subscription(first)
        self._start_subscription(second)
        first.close()
        topic.publish(b"still-live")

        try:
            assert self._receive_message(second) == b"still-live"
            entries = redis_client.xrange(topic._key)
            payloads = [fields[b"data"] for _, fields in entries]
            assert payloads == [b"still-live"]
            assert SIG_CLOSE not in payloads
        finally:
            second.close()

    def test_topic_isolation(self, broadcast_channel: BroadcastChannel) -> None:
        """Messages from different topics should remain isolated."""
        topic1 = broadcast_channel.topic(self._get_test_topic_name())
        topic2 = broadcast_channel.topic(self._get_test_topic_name())
        message1 = b"message-for-topic-1"
        message2 = b"message-for-topic-2"

        def consume_single_message(topic: Topic) -> bytes:
            subscription = topic.subscribe()
            try:
                self._start_subscription(subscription)
                return self._receive_message(subscription)
            finally:
                subscription.close()

        with ThreadPoolExecutor(max_workers=3) as executor:
            consumer1_future = executor.submit(consume_single_message, topic1)
            consumer2_future = executor.submit(consume_single_message, topic2)
            time.sleep(0.1)
            topic1.publish(message1)
            topic2.publish(message2)

            assert consumer1_future.result(timeout=5.0) == message1
            assert consumer2_future.result(timeout=5.0) == message2

    def test_concurrent_producers_publish_all_messages(self, broadcast_channel: BroadcastChannel) -> None:
        """Concurrent producers should not lose messages for a live subscription."""
        topic = broadcast_channel.topic(self._get_test_topic_name())
        subscription = topic.subscribe()
        producer_count = 4
        messages_per_producer = 4
        expected_total = producer_count * messages_per_producer
        consumer_ready = threading.Event()

        def produce_messages(producer_idx: int) -> set[bytes]:
            producer = topic.as_producer()
            produced: set[bytes] = set()
            for message_idx in range(messages_per_producer):
                payload = f"producer-{producer_idx}-message-{message_idx}".encode()
                produced.add(payload)
                producer.publish(payload)
                time.sleep(0.001)
            return produced

        def consume_messages() -> set[bytes]:
            received: set[bytes] = set()
            try:
                self._start_subscription(subscription)
                consumer_ready.set()
                while len(received) < expected_total:
                    message = subscription.receive(timeout=0.2)
                    if message is not None:
                        received.add(message)
                return received
            finally:
                subscription.close()

        with ThreadPoolExecutor(max_workers=producer_count + 1) as executor:
            consumer_future = executor.submit(consume_messages)
            assert consumer_ready.wait(timeout=2.0)

            producer_futures = [executor.submit(produce_messages, idx) for idx in range(producer_count)]
            expected_messages: set[bytes] = set()
            for future in as_completed(producer_futures, timeout=10.0):
                expected_messages.update(future.result())

            assert consumer_future.result(timeout=10.0) == expected_messages

    def test_receive_raises_subscription_closed_after_close(self, broadcast_channel: BroadcastChannel) -> None:
        """Calling receive on a closed subscription should raise SubscriptionClosedError."""
        topic = broadcast_channel.topic(self._get_test_topic_name())
        subscription = topic.subscribe()

        self._start_subscription(subscription)
        subscription.close()

        with pytest.raises(SubscriptionClosedError):
            subscription.receive(timeout=0.1)
