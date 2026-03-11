"""
Integration tests for RateLimiter using testcontainers Redis.
"""

import uuid

import pytest

from extensions.ext_redis import redis_client
from libs import helper as helper_module


@pytest.mark.usefixtures("flask_app_with_containers")
def test_rate_limiter_counts_multiple_attempts_in_same_second(monkeypatch):
    prefix = f"test_rate_limit:{uuid.uuid4().hex}"
    limiter = helper_module.RateLimiter(prefix=prefix, max_attempts=2, time_window=60)
    key = limiter._get_key("203.0.113.10")

    redis_client.delete(key)
    monkeypatch.setattr(helper_module.time, "time", lambda: 1_700_000_000)

    limiter.increment_rate_limit("203.0.113.10")
    limiter.increment_rate_limit("203.0.113.10")

    assert limiter.is_rate_limited("203.0.113.10") is True
