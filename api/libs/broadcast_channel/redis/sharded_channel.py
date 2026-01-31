from __future__ import annotations

from libs.broadcast_channel.channel import Producer, Subscriber, Subscription
from redis import Redis

from ._subscription import RedisSubscriptionBase


class ShardedRedisBroadcastChannel:
    """
    Redis 7.0+ Sharded Pub/Sub based broadcast channel implementation.

    Provides "at most once" delivery semantics using SPUBLISH/SSUBSCRIBE commands,
    distributing channels across Redis cluster nodes for better scalability.
    """

    def __init__(
        self,
        redis_client: Redis,
    ):
        self._client = redis_client

    def topic(self, topic: str) -> ShardedTopic:
        return ShardedTopic(self._client, topic)


class ShardedTopic:
    def __init__(self, redis_client: Redis, topic: str):
        self._client = redis_client
        self._topic = topic

    def as_producer(self) -> Producer:
        return self

    def publish(self, payload: bytes) -> None:
        self._client.spublish(self._topic, payload)  # type: ignore[attr-defined]

    def as_subscriber(self) -> Subscriber:
        return self

    def subscribe(self) -> Subscription:
        return _RedisShardedSubscription(
            pubsub=self._client.pubsub(),
            topic=self._topic,
        )


class _RedisShardedSubscription(RedisSubscriptionBase):
    """Redis 7.0+ sharded pub/sub subscription implementation."""

    def _get_subscription_type(self) -> str:
        return "sharded"

    def _subscribe(self) -> None:
        assert self._pubsub is not None
        self._pubsub.ssubscribe(self._topic)  # type: ignore[attr-defined]

    def _unsubscribe(self) -> None:
        assert self._pubsub is not None
        self._pubsub.sunsubscribe(self._topic)  # type: ignore[attr-defined]

    def _get_message(self) -> dict | None:
        assert self._pubsub is not None
        return self._pubsub.get_sharded_message(ignore_subscribe_messages=True, timeout=0.1)  # type: ignore[attr-defined]

    def _get_message_type(self) -> str:
        return "smessage"
