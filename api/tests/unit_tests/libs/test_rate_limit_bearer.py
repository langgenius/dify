"""Unit tests for the per-token bearer rate limit primitive."""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch

import pytest
from redis import Redis
from werkzeug.exceptions import TooManyRequests

from libs.helper import RateLimiter
from libs.rate_limit import (
    LIMIT_BEARER_PER_TOKEN,
    RateLimit,
    RateLimitScope,
    enforce_bearer_rate_limit,
)


@pytest.fixture
def redis_client():
    return Redis()


def test_limit_bearer_per_token_uses_60_per_minute_default():
    assert LIMIT_BEARER_PER_TOKEN.limit == 60
    assert LIMIT_BEARER_PER_TOKEN.window == timedelta(minutes=1)


def test_seconds_until_available_returns_remaining_window(redis_client, monkeypatch: pytest.MonkeyPatch):
    """ZSET oldest entry score = 100; window = 60s; now = 130s → remaining = 30s."""
    rl = RateLimiter("rl:bearer:token", max_attempts=60, time_window=60, redis_client=redis_client)
    monkeypatch.setattr(redis_client, "execute_command", lambda *_args, **_kwargs: [(b"member-1", 100.0)])
    with patch("libs.helper.time.time", return_value=130):
        assert rl.seconds_until_available("k1") == 30


def test_seconds_until_available_floor_one_second(redis_client, monkeypatch: pytest.MonkeyPatch):
    """Even when math says <1s remaining, return at least 1 so client backs off measurably."""
    rl = RateLimiter("rl:bearer:token", max_attempts=60, time_window=60, redis_client=redis_client)
    monkeypatch.setattr(redis_client, "execute_command", lambda *_args, **_kwargs: [(b"member-1", 119.5)])
    with patch("libs.helper.time.time", return_value=180):
        # window expired (180 > 119.5+60=179.5 by 0.5s) — bucket is actually free now
        # but this method only called when is_rate_limited() == True; defensive floor.
        assert rl.seconds_until_available("k1") >= 1


def test_seconds_until_available_empty_bucket(redis_client, monkeypatch: pytest.MonkeyPatch):
    """No entries → 1s sentinel (defensive; should not be reached when limited)."""
    rl = RateLimiter("rl:bearer:token", max_attempts=60, time_window=60, redis_client=redis_client)
    monkeypatch.setattr(redis_client, "execute_command", lambda *_args, **_kwargs: [])
    assert rl.seconds_until_available("k1") == 1


@patch("libs.rate_limit._build_limiter")
def test_enforce_bearer_rate_limit_passes_under_limit(mock_build, redis_client, monkeypatch: pytest.MonkeyPatch):
    commands: list[tuple] = []

    def execute_command(*args, **_kwargs):
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
    mock_build, redis_client, monkeypatch: pytest.MonkeyPatch
):
    commands: list[tuple] = []

    def execute_command(*args, **_kwargs):
        commands.append(args)
        if args[0] == "ZRANGE":
            return [(b"member-1", 63.0)]
        return 60 if args[0] == "ZCARD" else 0

    monkeypatch.setattr(redis_client, "execute_command", execute_command)
    limiter = RateLimiter("rl:bearer:token", max_attempts=60, time_window=60, redis_client=redis_client)
    mock_build.return_value = limiter
    with patch("libs.helper.time.time", return_value=100), pytest.raises(TooManyRequests) as exc:
        enforce_bearer_rate_limit("hash-1")
    assert [command[0] for command in commands] == ["ZREMRANGEBYSCORE", "ZCARD", "ZRANGE"]
    # Header-only TooManyRequests: the canonical ErrorBody (code "too_many_requests") is built
    # later by the openapi formatter; here we only assert the advisory header rides along.
    assert dict(exc.value.headers).get("Retry-After") == "23"


@patch("libs.rate_limit._build_limiter")
def test_enforce_bearer_rate_limit_disabled_when_limit_is_zero(mock_build, monkeypatch: pytest.MonkeyPatch):
    # 0 disables the limit — short-circuit before building/consulting a limiter.
    monkeypatch.setattr(
        "libs.rate_limit.LIMIT_BEARER_PER_TOKEN",
        RateLimit(limit=0, window=timedelta(minutes=1), scopes=(RateLimitScope.TOKEN_ID,)),
    )
    enforce_bearer_rate_limit("hash-1")
    mock_build.assert_not_called()
