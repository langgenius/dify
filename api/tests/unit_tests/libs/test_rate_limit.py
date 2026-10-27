"""Unit tests for the per-token bearer rate limit primitive."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from functools import partial
from typing import cast
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from redis import Redis
from werkzeug.exceptions import TooManyRequests, Unauthorized

from libs import rate_limit as rate_limit_module
from libs.helper import RateLimiter, _RateLimiterRedisClient
from libs.rate_limit import (
    LIMIT_BEARER_PER_TOKEN,
    LIMIT_CLIENT_AUTH_FAILURE,
    LIMIT_DEVICE_CODE_PER_IP,
    LIMIT_LOOKUP_PUBLIC,
    RATE_LIMIT_IDENTITY_MISSING,
    RateLimit,
    RateLimitScope,
    _BearerRateLimited,
    enforce_bearer_rate_limit,
    is_limited,
    limiter_prefix,
    rate_limit,
    record_hit,
)


@pytest.fixture
def redis_client() -> _RateLimiterRedisClient:
    # A real client whose execute_command each test replaces. RateLimiter's protocol follows dify's
    # RedisClientWrapper, whose zadd accepts a wider mapping than redis-py's stubs.
    return cast(_RateLimiterRedisClient, Redis())


def test_limit_bearer_per_token_uses_60_per_minute_default() -> None:
    assert LIMIT_BEARER_PER_TOKEN.limit == 60
    assert LIMIT_BEARER_PER_TOKEN.window == timedelta(minutes=1)


def test_seconds_until_available_returns_remaining_window(
    redis_client: _RateLimiterRedisClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """ZSET oldest entry score = 100; window = 60s; now = 130s → remaining = 30s."""
    rl = RateLimiter("rl:bearer:token", max_attempts=60, time_window=60, redis_client=redis_client)
    monkeypatch.setattr(redis_client, "execute_command", lambda *_args, **_kwargs: [(b"member-1", 100.0)])
    with patch("libs.helper.time.time", return_value=130):
        assert rl.seconds_until_available("k1") == 30


def test_seconds_until_available_floor_one_second(
    redis_client: _RateLimiterRedisClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Even when math says <1s remaining, return at least 1 so client backs off measurably."""
    rl = RateLimiter("rl:bearer:token", max_attempts=60, time_window=60, redis_client=redis_client)
    monkeypatch.setattr(redis_client, "execute_command", lambda *_args, **_kwargs: [(b"member-1", 119.5)])
    with patch("libs.helper.time.time", return_value=180):
        # window expired (180 > 119.5+60=179.5 by 0.5s) — bucket is actually free now
        # but this method only called when is_rate_limited() == True; defensive floor.
        assert rl.seconds_until_available("k1") >= 1


def test_seconds_until_available_empty_bucket(
    redis_client: _RateLimiterRedisClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No entries → 1s sentinel (defensive; should not be reached when limited)."""
    rl = RateLimiter("rl:bearer:token", max_attempts=60, time_window=60, redis_client=redis_client)
    monkeypatch.setattr(redis_client, "execute_command", lambda *_args, **_kwargs: [])
    assert rl.seconds_until_available("k1") == 1


@patch("libs.rate_limit._build_limiter")
def test_enforce_bearer_rate_limit_passes_under_limit(
    mock_build: MagicMock, redis_client: _RateLimiterRedisClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    commands: list[tuple[object, ...]] = []

    def execute_command(*args: object, **_kwargs: object) -> int:
        commands.append(args)
        return 0

    monkeypatch.setattr(redis_client, "execute_command", execute_command)
    limiter = RateLimiter(
        "rl:bearer:token", max_attempts=60, time_window=60, member_factory=lambda: "member-1", redis_client=redis_client
    )
    mock_build.return_value = limiter
    with patch("libs.helper.time.time", return_value=100):
        enforce_bearer_rate_limit("hash-1")
    assert commands == [
        ("ZREMRANGEBYSCORE", "rl:bearer:token:token:hash-1", "-inf", 40),
        ("ZCARD", "rl:bearer:token:token:hash-1"),
        ("ZADD", "rl:bearer:token:token:hash-1", 100, "member-1"),
        ("EXPIRE", "rl:bearer:token:token:hash-1", 120),
    ]


@patch("libs.rate_limit._build_limiter")
def test_enforce_bearer_rate_limit_raises_429_with_retry_after(
    mock_build: MagicMock, redis_client: _RateLimiterRedisClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    commands: list[tuple[object, ...]] = []

    def execute_command(*args: object, **_kwargs: object) -> list[tuple[bytes, float]] | int:
        commands.append(args)
        if args[0] == "ZRANGE":
            return [(b"member-1", 63.0)]
        return 60 if args[0] == "ZCARD" else 0

    monkeypatch.setattr(redis_client, "execute_command", execute_command)
    limiter = RateLimiter("rl:bearer:token", max_attempts=60, time_window=60, redis_client=redis_client)
    mock_build.return_value = limiter
    with patch("libs.helper.time.time", return_value=100), pytest.raises(_BearerRateLimited) as exc:
        enforce_bearer_rate_limit("hash-1")
    assert [command[0] for command in commands] == ["ZREMRANGEBYSCORE", "ZCARD", "ZRANGE"]
    # Header-only TooManyRequests: the canonical ErrorBody (code "too_many_requests") is built
    # later by the openapi formatter; here we only assert the advisory header rides along.
    assert dict(exc.value.headers).get("Retry-After") == "23"


@patch("libs.rate_limit._build_limiter")
def test_enforce_bearer_rate_limit_disabled_when_limit_is_zero(
    mock_build: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 0 disables the limit — short-circuit before building/consulting a limiter.
    monkeypatch.setattr(
        "libs.rate_limit.LIMIT_BEARER_PER_TOKEN",
        RateLimit(name="bearer_per_token", limit=0, window=timedelta(minutes=1), scopes=(RateLimitScope.TOKEN_ID,)),
    )
    enforce_bearer_rate_limit("hash-1")
    mock_build.assert_not_called()


@dataclass
class _FakeZsetRedis:
    zsets: dict[str, dict[str, float]] = field(default_factory=dict)

    def zadd(self, name: str, mapping: dict[str, float]) -> int:
        self.zsets.setdefault(name, {}).update(mapping)
        return len(mapping)

    def zremrangebyscore(self, name: str, _min: str | float, max: str | float) -> int:
        entries = self.zsets.get(name, {})
        stale = [member for member, score in entries.items() if score <= float(max)]
        for member in stale:
            del entries[member]
        return len(stale)

    def zcard(self, name: str) -> int:
        return len(self.zsets.get(name, {}))

    def expire(self, _name: str, _time: int) -> bool:
        return True


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> _FakeZsetRedis:
    fake = _FakeZsetRedis()
    monkeypatch.setattr(
        rate_limit_module, "RateLimiter", partial(RateLimiter, redis_client=cast(_RateLimiterRedisClient, fake))
    )
    return fake


@pytest.fixture
def app() -> Flask:
    flask_app = Flask(__name__)
    flask_app.secret_key = "test"
    return flask_app


def _hit(spec: RateLimit) -> None:
    rate_limit(spec)(lambda: None)()


@pytest.mark.usefixtures("fake_redis")
def test_lookup_calls_do_not_trim_device_code_entries(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("libs.helper.time.time", lambda: 1_000_000)
    with app.test_request_context("/", environ_base={"REMOTE_ADDR": "203.0.113.7"}):
        for _ in range(LIMIT_DEVICE_CODE_PER_IP.limit):
            _hit(LIMIT_DEVICE_CODE_PER_IP)

        # Past the lookup window (5 min) but inside the device-code window (1 h).
        monkeypatch.setattr("libs.helper.time.time", lambda: 1_000_000 + 600)
        _hit(LIMIT_LOOKUP_PUBLIC)

        with pytest.raises(TooManyRequests):
            _hit(LIMIT_DEVICE_CODE_PER_IP)


@dataclass
class _FakeConsoleAccount:
    id: str


def _as_console_account(monkeypatch: pytest.MonkeyPatch, account_id: str | None) -> None:
    account = _FakeConsoleAccount(id=account_id) if account_id else None
    monkeypatch.setattr("libs.login.current_account_with_tenant_optional", lambda: (account, None))


@pytest.mark.parametrize("scope", [RateLimitScope.IP, RateLimitScope.CONSOLE_ACCOUNT])
def test_scope_without_identity_fails_closed(
    app: Flask, fake_redis: _FakeZsetRedis, monkeypatch: pytest.MonkeyPatch, scope: RateLimitScope
) -> None:
    _as_console_account(monkeypatch, None)
    spec = RateLimit(name="no_identity", limit=5, window=timedelta(minutes=1), scopes=(scope,))
    with app.test_request_context("/"):
        with pytest.raises(Unauthorized) as caught:
            _hit(spec)

    assert caught.value.description == RATE_LIMIT_IDENTITY_MISSING
    assert fake_redis.zsets == {}


def test_a_zero_limit_never_counts_and_needs_no_identity(app: Flask, fake_redis: _FakeZsetRedis) -> None:
    off = RateLimit(name="off", limit=0, window=timedelta(minutes=1), scopes=(RateLimitScope.IP,))
    with app.test_request_context("/"):
        for _ in range(5):
            _hit(off)
    record_hit(off, key="k")

    assert not is_limited(off, key="k")
    assert fake_redis.zsets == {}


def test_manual_helpers_count_per_key(fake_redis: _FakeZsetRedis) -> None:
    key = "client:qwenwork"
    for _ in range(LIMIT_CLIENT_AUTH_FAILURE.limit):
        assert not is_limited(LIMIT_CLIENT_AUTH_FAILURE, key=key)
        record_hit(LIMIT_CLIENT_AUTH_FAILURE, key=key)

    assert is_limited(LIMIT_CLIENT_AUTH_FAILURE, key=key)
    assert not is_limited(LIMIT_CLIENT_AUTH_FAILURE, key="client:other")
    assert set(fake_redis.zsets) == {f"{limiter_prefix(LIMIT_CLIENT_AUTH_FAILURE)}:{key}"}
