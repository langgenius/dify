from collections.abc import Callable
from typing import cast

import pytest
from redis import Redis

from libs.durable_stream import CursorUnavailableError, DurableStreamUnavailableError
from libs.durable_stream.redis import RedisDurableStreamTopic
from tests.unit_tests.libs.durable_stream.redis.fake_redis import FakeRedisDurableStream


def test_topic_uses_configured_redis_key_prefix(config_overrides: Callable[..., None]) -> None:
    config_overrides(REDIS_KEY_PREFIX="tenant-a")
    redis = FakeRedisDurableStream()

    topic = RedisDurableStreamTopic(cast("Redis[bytes]", redis), "workflow-1")

    assert topic._key == "tenant-a:durable_stream:workflow-1"


def test_append_and_seal_refresh_retention_and_keep_one_seal_marker() -> None:
    redis = FakeRedisDurableStream()
    topic = RedisDurableStreamTopic(cast("Redis[bytes]", redis), "retention", retention_seconds=42)

    topic.append(b"record")
    topic.seal()
    topic.seal()

    assert redis.expirations[topic._key] == 42
    assert [fields[b"kind"] for _, fields in redis.entries(topic._key)] == [b"data", b"seal"]


def test_subscription_creation_maps_redis_failure() -> None:
    redis = FakeRedisDurableStream()
    topic = RedisDurableStreamTopic(cast("Redis[bytes]", redis), "unavailable")
    redis.fail_next_eval = True

    with pytest.raises(DurableStreamUnavailableError):
        topic.subscribe_from_tail()


def test_empty_subscription_detects_boundary_trim_before_entry() -> None:
    redis = FakeRedisDurableStream()
    topic = RedisDurableStreamTopic(cast("Redis[bytes]", redis), "trimmed", max_length=2)
    subscription = topic.subscribe_from_tail()

    topic.append(b"first")
    topic.append(b"second")

    with pytest.raises(CursorUnavailableError):
        subscription.__enter__()
