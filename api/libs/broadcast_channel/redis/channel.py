from __future__ import annotations

from libs.broadcast_channel.channel import Producer, Subscriber, Subscription
from redis import Redis

from ._subscription import RedisSubscriptionBase


class BroadcastChannel:
    """
    Redis Pub/Sub based broadcast channel implementation (regular, non-sharded).

    Provides "at most once" delivery semantics for messages published to channels
    using Redis PUBLISH/SUBSCRIBE commands for real-time message delivery.

    The `redis_client` used to construct BroadcastChannel should have `decode_responses` set to `False`.
    """

    def __init__(
        self,
        redis_client: Redis,
    ):
        self._client = redis_client

    def topic(self, topic: str) -> Topic:
        return Topic(self._client, topic)


class Topic:
    def __init__(self, redis_client: Redis, topic: str):
        self._client = redis_client
        self._topic = topic

    def as_producer(self) -> Producer:
        return self

    def publish(self, payload: bytes) -> None:
        self._client.publish(self._topic, payload)

    def as_subscriber(self) -> Subscriber:
        return self

    def subscribe(self) -> Subscription:
        return _RedisSubscription(
            pubsub=self._client.pubsub(),
            topic=self._topic,
        )


class _RedisSubscription(RedisSubscriptionBase):
    """Regular Redis pub/sub subscription implementation."""

    def _get_subscription_type(self) -> str:
        return "regular"

    def _subscribe(self) -> None:
        assert self._pubsub is not None
        self._pubsub.subscribe(self._topic)

    def _unsubscribe(self) -> None:
        assert self._pubsub is not None
        self._pubsub.unsubscribe(self._topic)

    def _get_message(self) -> dict | None:
        assert self._pubsub is not None
        return self._pubsub.get_message(ignore_subscribe_messages=True, timeout=0.1)

    def _get_message_type(self) -> str:
        return "message"
