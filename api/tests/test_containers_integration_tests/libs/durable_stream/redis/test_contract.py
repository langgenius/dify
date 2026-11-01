from __future__ import annotations

import uuid
from collections.abc import Iterator, Mapping, Sequence
from typing import cast, override

import pytest
import redis
from redis.exceptions import ConnectionError
from testcontainers.redis import RedisContainer

from libs.durable_stream import DurableStreamSubscription, DurableStreamTopic, TopicCursor
from libs.durable_stream.redis import RedisDurableStreamTopic
from libs.durable_stream.redis.stream import _RedisDurableStreamSubscription
from tests.unit_tests.libs.durable_stream.contract import DurableStreamContract


class _FaultInjectingRedis:
    def __init__(self, client: redis.Redis[bytes]) -> None:
        self._client = client
        self.fail_next_eval = False
        self.fail_next_xrange = False
        self.fail_next_xrevrange = False
        self.fail_next_xread = False

    def execute_command(self, *args: object, **options: object) -> object:
        if args and args[0] == "EVAL" and self.fail_next_eval:
            self.fail_next_eval = False
            raise ConnectionError("injected eval failure")
        return self._client.execute_command(*args, **options)

    def xrange(
        self,
        name: str,
        min: str = "-",
        max: str = "+",
        count: int | None = None,
    ) -> Sequence[object]:
        if self.fail_next_xrange:
            self.fail_next_xrange = False
            raise ConnectionError("injected xrange failure")
        return self._client.xrange(name, min=min, max=max, count=count)

    def xrevrange(
        self,
        name: str,
        max: str = "+",
        min: str = "-",
        count: int | None = None,
    ) -> Sequence[object]:
        if self.fail_next_xrevrange:
            self.fail_next_xrevrange = False
            raise ConnectionError("injected xrevrange failure")
        return self._client.xrevrange(name, max=max, min=min, count=count)

    def xread(
        self,
        streams: Mapping[str, str],
        count: int | None = None,
        block: int | None = None,
    ) -> Sequence[object]:
        if self.fail_next_xread:
            self.fail_next_xread = False
            raise ConnectionError("injected xread failure")
        return self._client.xread(streams, count=count, block=block)


class TestRedisDurableStreamContract(DurableStreamContract):
    @pytest.fixture(scope="class")
    def redis_container(self) -> Iterator[RedisContainer]:
        with RedisContainer(image="redis:6-alpine") as container:
            yield container

    @pytest.fixture(scope="class")
    def redis_client(self, redis_container: RedisContainer) -> redis.Redis[bytes]:
        return redis.Redis(
            host=redis_container.get_container_host_ip(),
            port=redis_container.get_exposed_port(6379),
            decode_responses=False,
        )

    @pytest.fixture(autouse=True)
    def configure_redis(self, redis_client: redis.Redis[bytes]) -> None:
        self._redis = _FaultInjectingRedis(redis_client)

    @override
    def create_topic(self, name: str) -> DurableStreamTopic:
        unique_name = f"contract:{name}:{uuid.uuid4()}"
        return RedisDurableStreamTopic(cast("redis.Redis[bytes]", self._redis), unique_name)

    @override
    def make_cursor_unavailable(self, topic: DurableStreamTopic, cursor: TopicCursor) -> None:
        assert isinstance(topic, RedisDurableStreamTopic)
        self._redis._client.xdel(topic._key, topic._decode_cursor(cursor))

    @override
    def fail_next_append(self, topic: DurableStreamTopic) -> None:
        del topic
        self._redis.fail_next_eval = True

    @override
    def fail_next_receive(self, subscription: DurableStreamSubscription) -> None:
        del subscription
        self._redis.fail_next_xread = True

    @override
    def fail_next_enter_after_acquiring_resources(self, subscription: DurableStreamSubscription) -> None:
        del subscription
        self._redis.fail_next_xrange = True

    @override
    def assert_subscription_resources_released(self, subscription: DurableStreamSubscription) -> None:
        assert isinstance(subscription, _RedisDurableStreamSubscription)
        assert subscription._closed
        assert not subscription._entered
