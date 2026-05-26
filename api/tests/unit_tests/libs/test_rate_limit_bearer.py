"""Unit tests for the per-token bearer rate limit primitive."""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import TooManyRequests

from libs.helper import RateLimiter
from libs.rate_limit import (
    LIMIT_BEARER_PER_TOKEN,
    enforce_bearer_rate_limit,
)


@pytest.fixture
def mock_redis():
    return MagicMock()


def test_limit_bearer_per_token_uses_60_per_minute_default():
    assert LIMIT_BEARER_PER_TOKEN.limit == 60
    assert LIMIT_BEARER_PER_TOKEN.window == timedelta(minutes=1)


def test_seconds_until_available_returns_remaining_window(mock_redis):
    """ZSET oldest entry score = 100; window = 60s; now = 130s → remaining = 30s."""
    rl = RateLimiter("rl:bearer:token", max_attempts=60, time_window=60, redis_client=mock_redis)
    mock_redis.zrange.return_value = [(b"member-1", 100.0)]
    with patch("libs.helper.time.time", return_value=130):
        assert rl.seconds_until_available("k1") == 30


def test_seconds_until_available_floor_one_second(mock_redis):
    """Even when math says <1s remaining, return at least 1 so client backs off measurably."""
    rl = RateLimiter("rl:bearer:token", max_attempts=60, time_window=60, redis_client=mock_redis)
    mock_redis.zrange.return_value = [(b"member-1", 119.5)]
    with patch("libs.helper.time.time", return_value=180):
        # window expired (180 > 119.5+60=179.5 by 0.5s) — bucket is actually free now
        # but this method only called when is_rate_limited() == True; defensive floor.
        assert rl.seconds_until_available("k1") >= 1


def test_seconds_until_available_empty_bucket(mock_redis):
    """No entries → 1s sentinel (defensive; should not be reached when limited)."""
    rl = RateLimiter("rl:bearer:token", max_attempts=60, time_window=60, redis_client=mock_redis)
    mock_redis.zrange.return_value = []
    assert rl.seconds_until_available("k1") == 1


@patch("libs.rate_limit._build_limiter")
def test_enforce_bearer_rate_limit_passes_under_limit(mock_build):
    limiter = MagicMock()
    limiter.is_rate_limited.return_value = False
    mock_build.return_value = limiter
    enforce_bearer_rate_limit("hash-1")
    limiter.increment_rate_limit.assert_called_once_with("token:hash-1")


@patch("libs.rate_limit._build_limiter")
def test_enforce_bearer_rate_limit_raises_429_with_retry_after(mock_build):
    limiter = MagicMock()
    limiter.is_rate_limited.return_value = True
    limiter.seconds_until_available.return_value = 23
    mock_build.return_value = limiter
    with pytest.raises(TooManyRequests) as exc:
        enforce_bearer_rate_limit("hash-1")
    headers = dict(exc.value.get_response().headers)
    assert headers.get("Retry-After") == "23"
    body = exc.value.get_response().get_json() or {}
    assert body.get("error") == "rate_limited"
    assert body.get("retry_after_ms") == 23000
