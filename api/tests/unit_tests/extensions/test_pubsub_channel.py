import pytest

from configs import dify_config
from extensions import ext_redis
from libs.broadcast_channel.redis.channel import BroadcastChannel as RedisBroadcastChannel
from libs.broadcast_channel.redis.sharded_channel import ShardedRedisBroadcastChannel


def test_get_pubsub_broadcast_channel_defaults_to_pubsub(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(dify_config, "PUBSUB_REDIS_CHANNEL_TYPE", "pubsub")
    monkeypatch.setattr(ext_redis, "_pubsub_redis_client", object())

    channel = ext_redis.get_pubsub_broadcast_channel()

    assert isinstance(channel, RedisBroadcastChannel)


def test_get_pubsub_broadcast_channel_sharded(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(dify_config, "PUBSUB_REDIS_CHANNEL_TYPE", "sharded")
    monkeypatch.setattr(ext_redis, "_pubsub_redis_client", object())

    channel = ext_redis.get_pubsub_broadcast_channel()

    assert isinstance(channel, ShardedRedisBroadcastChannel)
