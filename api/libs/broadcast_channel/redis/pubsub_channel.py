from __future__ import annotations

import logging
from typing import Any, override

from extensions.redis_names import serialize_redis_name
from libs.broadcast_channel.channel import Producer, Subscriber, Subscription
from libs.broadcast_channel.signals import SIG_CLOSE
from redis import Redis, RedisCluster

from ._subscription import RedisSubscriptionBase

logger = logging.getLogger(__name__)


class BroadcastChannel:
    """
    Redis Pub/Sub based broadcast channel implementation (regular, non-sharded).

    Provides "at most once" delivery semantics for messages published to channels
    using Redis PUBLISH/SUBSCRIBE commands for real-time message delivery.

    The `redis_client` used to construct BroadcastChannel should have `decode_responses` set to `False`.
    """

    def __init__(
        self,
        redis_client: Redis | RedisCluster,
    ):
        self._client = redis_client

    def topic(self, topic: str) -> Topic:
        return Topic(self._client, topic)


class Topic:
    def __init__(
        self,
        redis_client: Redis | RedisCluster,
        topic: str,
    ):
        self._client = redis_client
        self._topic = topic
        self._redis_topic = serialize_redis_name(topic)

    def as_producer(self) -> Producer:
        return self

    def publish(self, payload: bytes) -> None:
        self._client.publish(self._redis_topic, payload)

    def as_subscriber(self) -> Subscriber:
        return self

    def subscribe(self) -> Subscription:
        return _RedisSubscription(
            client=self._client,
            pubsub=self._client.pubsub(),
            topic=self._redis_topic,
        )


class _RedisSubscription(RedisSubscriptionBase):
    """Regular Redis pub/sub subscription implementation."""

    @override
    def _get_subscription_type(self) -> str:
        return "regular"

    @override
    def _publish_close_event(self) -> None:
        try:
            self._client.publish(self._topic, SIG_CLOSE)
        except Exception:
            logger.exception("failed to publish close event")

    @override
    def _subscribe(self) -> None:
        assert self._pubsub is not None
        self._pubsub.subscribe(self._topic)

    @override
    def _unsubscribe(self) -> None:
        assert self._pubsub is not None
        self._pubsub.unsubscribe(self._topic)

    @override
    def _get_message(self) -> dict[str, Any] | None:
        assert self._pubsub is not None
        return self._pubsub.get_message(ignore_subscribe_messages=True, timeout=1)

    @override
    def _get_message_type(self) -> str:
        return "message"
