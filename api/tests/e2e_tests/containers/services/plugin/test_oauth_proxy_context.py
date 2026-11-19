from __future__ import annotations

from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import override

import pytest
import redis
from testcontainers.redis import RedisContainer

from extensions.ext_redis import RedisClientWrapper
from services.plugin import oauth_service
from services.plugin.oauth_service import OAuthProxyService


@pytest.fixture
def oauth_redis() -> Iterator[redis.Redis[bytes]]:
    with RedisContainer(image="redis:6-alpine") as container:
        client = redis.Redis(host=container.get_container_host_ip(), port=container.get_exposed_port(6379))
        try:
            yield client
        finally:
            client.close()


def test_oauth_context_can_only_be_consumed_once_concurrently(
    oauth_redis: redis.Redis[bytes], monkeypatch: pytest.MonkeyPatch
) -> None:
    reads = Barrier(2)

    class ConcurrentReadsRedis(RedisClientWrapper):
        @override
        def get(self, name: str | bytes) -> object:
            value = super().get(name)
            reads.wait(timeout=5)
            return value

    wrapper = ConcurrentReadsRedis()
    wrapper.initialize(oauth_redis)
    monkeypatch.setattr(oauth_service, "redis_client", wrapper)
    expected = {"user_id": "u1", "tenant_id": "t1", "plugin_id": "p1", "provider": "github"}
    context_id = OAuthProxyService.create_proxy_context(**expected)
    start = Barrier(2)

    def consume() -> dict[str, str] | str:
        start.wait(timeout=5)
        try:
            return OAuthProxyService.use_proxy_context(context_id)
        except ValueError as exc:
            return str(exc)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: consume(), range(2)))

    assert results.count(expected) == 1
    assert results.count("context_id is invalid") == 1
