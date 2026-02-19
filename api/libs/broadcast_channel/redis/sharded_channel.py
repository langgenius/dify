from __future__ import annotations

from libs.broadcast_channel.channel import Producer, Subscriber, Subscription
from redis import Redis, RedisCluster

from ._subscription import RedisSubscriptionBase


class ShardedRedisBroadcastChannel:
    """
    Redis 7.0+ Sharded Pub/Sub based broadcast channel implementation.

    Provides "at most once" delivery semantics using SPUBLISH/SSUBSCRIBE commands,
    distributing channels across Redis cluster nodes for better scalability.
    """

    def __init__(
        self,
        redis_client: Redis | RedisCluster,
    ):
        self._client = redis_client

    def topic(self, topic: str) -> ShardedTopic:
        return ShardedTopic(self._client, topic)


class ShardedTopic:
    def __init__(self, redis_client: Redis | RedisCluster, topic: str):
        self._client = redis_client
        self._topic = topic

    def as_producer(self) -> Producer:
        return self

    def publish(self, payload: bytes) -> None:
        self._client.spublish(self._topic, payload)  # type: ignore[attr-defined,union-attr]

    def as_subscriber(self) -> Subscriber:
        return self

    def subscribe(self) -> Subscription:
        return _RedisShardedSubscription(
            client=self._client,
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
        # NOTE(QuantumGhost): this is an issue in
        # upstream code. If Sharded PubSub is used with Cluster, the
        # `ClusterPubSub.get_sharded_message` will return `None` regardless of
        # message['type'].
        #
        # Since we have already filtered at the caller's site, we can safely set
        # `ignore_subscribe_messages=False`.
        if isinstance(self._client, RedisCluster):
            # NOTE(QuantumGhost): due to an issue in upstream code, calling `get_sharded_message` without
            # specifying the `target_node` argument would use busy-looping to wait
            # for incoming message, consuming excessive CPU quota.
            #
            # Here we specify the `target_node` to mitigate this problem.
            node = self._client.get_node_from_key(self._topic)
            return self._pubsub.get_sharded_message(  # type: ignore[attr-defined]
                ignore_subscribe_messages=False,
                timeout=1,
                target_node=node,
            )
        elif isinstance(self._client, Redis):
            return self._pubsub.get_sharded_message(ignore_subscribe_messages=False, timeout=1)  # type: ignore[attr-defined]
        else:
            raise AssertionError("client should be either Redis or RedisCluster.")

    def _get_message_type(self) -> str:
        return "smessage"
