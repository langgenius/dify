"""Behavior of TTL-preserving scalar counters on real Redis (CI only)."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest

from extensions.ext_redis import redis_client

pytestmark = pytest.mark.usefixtures("flask_app_with_containers")


def test_increment_preserves_counter_ttl_without_resetting_it() -> None:
    key = f"counter-test:{uuid4()}"
    redis_client.set(key, 0, ex=60)
    try:
        for expected in range(1, 7):
            assert redis_client.incr_if_exists(key) == expected
            assert redis_client.get(key) == str(expected).encode()
            assert 0 < redis_client.ttl(key) <= 60
    finally:
        redis_client.delete(key)
    assert redis_client.incr_if_exists(key) is None
    assert not redis_client.exists(key)


def test_expired_counter_is_not_recreated() -> None:
    key = f"counter-test:{uuid4()}"
    redis_client.set(key, 0, ex=60)
    redis_client.expire(key, 0)
    assert redis_client.incr_if_exists(key) is None
    assert not redis_client.exists(key)


def test_concurrent_increments_do_not_lose_updates() -> None:
    key = f"counter-test:{uuid4()}"
    redis_client.set(key, 0, ex=60)
    barrier = Barrier(12)

    def increment(_: int) -> int | None:
        barrier.wait()
        return redis_client.incr_if_exists(key)

    try:
        with ThreadPoolExecutor(max_workers=12) as executor:
            counts = list(executor.map(increment, range(12)))
        assert sorted(count for count in counts if count is not None) == list(range(1, 13))
        assert redis_client.get(key) == b"12"
        assert 0 < redis_client.ttl(key) <= 60
    finally:
        redis_client.delete(key)
