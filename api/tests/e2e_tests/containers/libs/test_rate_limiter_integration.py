"""
Integration tests for RateLimiter using testcontainers Redis.
"""

import uuid
from collections.abc import Callable

import pytest

from extensions.ext_redis import redis_client
from libs import helper as helper_module


@pytest.mark.usefixtures("flask_app_with_containers")
def test_rate_limiter_counts_multiple_attempts_in_same_second(monkeypatch: pytest.MonkeyPatch) -> None:
    prefix = f"test_rate_limit:{uuid.uuid4().hex}"
    limiter = helper_module.RateLimiter(prefix=prefix, max_attempts=2, time_window=60)
    key = limiter._get_key("203.0.113.10")

    redis_client.delete(key)
    monkeypatch.setattr(helper_module.time, "time", lambda: 1_700_000_000)

    limiter.increment_rate_limit("203.0.113.10")
    limiter.increment_rate_limit("203.0.113.10")

    assert limiter.is_rate_limited("203.0.113.10") is True


@pytest.mark.usefixtures("flask_app_with_containers")
def test_reservation_admits_only_one_parallel_send() -> None:
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    limiter = helper_module.RateLimiter(prefix=f"test_rate_limit:{uuid.uuid4().hex}", max_attempts=1, time_window=60)
    ready = Barrier(16)

    def reserve(_index: int) -> bool:
        ready.wait(timeout=10)
        with limiter.reserve("user@example.com") as acquired:
            return acquired

    with ThreadPoolExecutor(max_workers=16) as executor:
        admitted = list(executor.map(reserve, range(16)))

    assert sum(admitted) == 1
    assert redis_client.zcard(limiter._get_key("user@example.com")) == 1


@pytest.mark.usefixtures("flask_app_with_containers")
def test_reservation_preserves_window_expiry_and_failed_send_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    limiter = helper_module.RateLimiter(prefix=f"test_rate_limit:{uuid.uuid4().hex}", max_attempts=1, time_window=60)
    email = "user@example.com"
    key = limiter._get_key(email)
    monkeypatch.setattr(helper_module.time, "time", lambda: 1000)

    def failed_send() -> None:
        with limiter.reserve(email) as acquired:
            assert acquired
            raise RuntimeError("queue unavailable")

    with pytest.raises(RuntimeError, match="queue unavailable"):
        failed_send()
    assert redis_client.zcard(key) == 0

    with limiter.reserve(email) as acquired:
        assert acquired
    with limiter.reserve(email) as acquired:
        assert not acquired
    assert 0 < redis_client.ttl(key) <= 120

    monkeypatch.setattr(helper_module.time, "time", lambda: 1059)
    with limiter.reserve(email) as acquired:
        assert not acquired
    monkeypatch.setattr(helper_module.time, "time", lambda: 1060)
    with limiter.reserve(email) as acquired:
        assert acquired
    assert redis_client.zcard(key) == 1


@pytest.mark.usefixtures("flask_app_with_containers")
def test_expired_reservation_failure_does_not_remove_later_send(monkeypatch: pytest.MonkeyPatch) -> None:
    limiter = helper_module.RateLimiter(prefix=f"test_rate_limit:{uuid.uuid4().hex}", max_attempts=1, time_window=60)
    email = "user@example.com"
    monkeypatch.setattr(helper_module.time, "time", lambda: 1000)

    def overlapping_sends() -> None:
        with limiter.reserve(email) as acquired:
            assert acquired
            monkeypatch.setattr(helper_module.time, "time", lambda: 1060)
            with limiter.reserve(email) as new_acquired:
                assert new_acquired
            raise RuntimeError("original send failed")

    with pytest.raises(RuntimeError, match="original send failed"):
        overlapping_sends()

    with limiter.reserve(email) as acquired:
        assert not acquired
    assert redis_client.zcard(limiter._get_key(email)) == 1


@pytest.mark.usefixtures("flask_app_with_containers")
def test_reservation_command_retry_is_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    limiter = helper_module.RateLimiter(prefix=f"test_rate_limit:{uuid.uuid4().hex}", max_attempts=1, time_window=60)
    register_script = redis_client.register_script

    def replay_registration(script: str) -> Callable[..., object]:
        execute = register_script(script)

        def execute_twice(*, keys: list[str], args: list[object]) -> object:
            execute(keys=keys, args=args)
            return execute(keys=keys, args=args)

        return execute_twice

    monkeypatch.setattr(redis_client, "register_script", replay_registration)
    with limiter.reserve("user@example.com") as acquired:
        assert acquired
    assert redis_client.zcard(limiter._get_key("user@example.com")) == 1
