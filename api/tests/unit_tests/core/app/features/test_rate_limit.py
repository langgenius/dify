from unittest.mock import MagicMock, patch

import pytest

from core.app.features.rate_limiting.rate_limit import RateLimit
from core.errors.error import AppInvokeQuotaExceededError


@pytest.fixture
def rate_limit(monkeypatch):
    """Build a RateLimit with cap=2 backed by a mocked Redis client.

    The cached-per-client_id RateLimit instance means leftover state from one
    test would leak into the next, so the class-level instance dict and the
    ``initialized`` flag are reset here for isolation.
    """
    RateLimit._instance_dict.clear()
    # Drop the cached instance so __init__ re-runs with fresh Redis state.
    for key in list(RateLimit.__dict__):
        if key == "initialized":
            monkeypatch.delattr(RateLimit, "initialized", raising=False)
    mock_redis = MagicMock()
    mock_redis.exists.return_value = 0
    # register_script returns a callable that we configure per test.
    admit = MagicMock()
    mock_redis.register_script.return_value = admit
    with patch("core.app.features.rate_limiting.rate_limit.redis_client", mock_redis):
        rl = RateLimit(client_id="test-client", max_active_requests=2)
        yield rl, admit
    RateLimit._instance_dict.clear()


def test_enter_admits_when_below_cap(rate_limit):
    rl, admit = rate_limit
    admit.return_value = 1  # HSET returns the number of new fields added.

    request_id = rl.enter()

    admit.assert_called_once()
    assert request_id  # a request id was returned


def test_enter_rejects_when_cap_reached(rate_limit):
    rl, admit = rate_limit
    # The Lua script returns nil (decoded to None) when HLEN already equals the
    # cap, i.e. the request was not admitted.
    admit.return_value = None

    with pytest.raises(AppInvokeQuotaExceededError):
        rl.enter()


def test_enter_returns_unlimited_id_when_disabled(monkeypatch):
    RateLimit._instance_dict.clear()
    monkeypatch.delattr(RateLimit, "initialized", raising=False)
    mock_redis = MagicMock()
    with patch("core.app.features.rate_limiting.rate_limit.redis_client", mock_redis):
        rl = RateLimit(client_id="disabled-client", max_active_requests=0)

    request_id = rl.enter(request_id="req-123")
    assert request_id == RateLimit._UNLIMITED_REQUEST_ID
    RateLimit._instance_dict.clear()


def test_enter_respects_explicit_request_id(rate_limit):
    rl, admit = rate_limit
    admit.return_value = 1

    request_id = rl.enter(request_id="explicit-id")
    assert request_id == "explicit-id"
    # The explicit id is forwarded to the script as the field name.
    _, kwargs = admit.call_args
    assert "explicit-id" in kwargs["args"]


def test_enter_flush_cache_runs_after_interval(rate_limit, monkeypatch):
    rl, admit = rate_limit
    admit.return_value = 1
    # Force the recalculation interval to look elapsed.
    monkeypatch.setattr(rl, "last_recalculate_time", 0.0)
    flush_spy = MagicMock()
    monkeypatch.setattr(rl, "flush_cache", flush_spy)

    rl.enter()

    flush_spy.assert_called_once()
