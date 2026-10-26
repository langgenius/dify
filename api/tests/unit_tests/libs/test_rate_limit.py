"""Unit tests for the per-token bearer rate limit primitive."""

from __future__ import annotations

import uuid
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
from libs.oauth_bearer import AuthContext, TokenType, _auth_ctx_var
from libs.rate_limit import (
    LIMIT_BEARER_PER_TOKEN,
    LIMIT_DEVICE_CODE_PER_IP,
    LIMIT_DEVICE_FLOW_APPROVE,
    LIMIT_LOOKUP_PUBLIC,
    RateLimit,
    RateLimitScope,
    _BearerRateLimited,
    enforce_bearer_rate_limit,
    limiter_prefix,
    rate_limit,
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
    writes: int = 0

    def zadd(self, name: str, mapping: dict[str, float]) -> int:
        self.writes += 1
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
    monkeypatch.setattr(rate_limit_module, "RateLimiter", partial(RateLimiter, redis_client=fake))
    return fake


@pytest.fixture
def app() -> Flask:
    flask_app = Flask(__name__)
    flask_app.secret_key = "test"
    return flask_app


def _ip_request(app: Flask, ip: str = "203.0.113.7"):
    return app.test_request_context("/", environ_base={"REMOTE_ADDR": ip})


def _hit(spec: RateLimit) -> None:
    rate_limit(spec)(lambda: None)()


def test_limits_with_same_scope_use_different_keys(app: Flask, fake_redis: _FakeZsetRedis) -> None:
    with _ip_request(app):
        _hit(LIMIT_DEVICE_CODE_PER_IP)
        _hit(LIMIT_LOOKUP_PUBLIC)

    assert len(fake_redis.zsets) == 2
    assert limiter_prefix(LIMIT_DEVICE_CODE_PER_IP) != limiter_prefix(LIMIT_LOOKUP_PUBLIC)
    assert {key.split(":ip:")[0] for key in fake_redis.zsets} == {
        limiter_prefix(LIMIT_DEVICE_CODE_PER_IP).removesuffix(":ip"),
        limiter_prefix(LIMIT_LOOKUP_PUBLIC).removesuffix(":ip"),
    }


@pytest.mark.usefixtures("fake_redis")
def test_lookup_calls_do_not_trim_device_code_entries(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("libs.helper.time.time", lambda: 1_000_000)
    with _ip_request(app):
        for _ in range(LIMIT_DEVICE_CODE_PER_IP.limit):
            _hit(LIMIT_DEVICE_CODE_PER_IP)

        # Past the lookup window (5 min) but inside the device-code window (1 h).
        monkeypatch.setattr("libs.helper.time.time", lambda: 1_000_000 + 600)
        _hit(LIMIT_LOOKUP_PUBLIC)

        with pytest.raises(TooManyRequests):
            _hit(LIMIT_DEVICE_CODE_PER_IP)


def test_every_limit_name_is_unique() -> None:
    limits = [value for value in vars(rate_limit_module).values() if isinstance(value, RateLimit)]
    names = [spec.name for spec in limits]

    assert limits
    assert len(names) == len(set(names))


def test_limiter_prefix_supports_empty_scopes() -> None:
    spec = RateLimit(name="manual", limit=1, window=timedelta(minutes=1), scopes=())

    assert limiter_prefix(spec) == "rl:manual:"


def _ctx() -> AuthContext:
    return AuthContext(
        token_type=TokenType.OAUTH_ACCOUNT,
        subject_email=None,
        subject_issuer=None,
        account_id=None,
        client_id=None,
        token_id=uuid.uuid4(),
        expires_at=None,
    )


@pytest.mark.parametrize(
    "scope",
    [RateLimitScope.IP, RateLimitScope.ACCOUNT, RateLimitScope.SUBJECT_EMAIL, RateLimitScope.TOKEN_ID],
)
def test_scope_without_identity_fails_closed(app: Flask, fake_redis: _FakeZsetRedis, scope: RateLimitScope) -> None:
    spec = RateLimit(name="no_identity", limit=5, window=timedelta(minutes=1), scopes=(scope,))
    ctx = _ctx() if scope in {RateLimitScope.ACCOUNT, RateLimitScope.SUBJECT_EMAIL} else None
    token = _auth_ctx_var.set(ctx) if ctx else None
    try:
        with app.test_request_context("/"):
            with pytest.raises(Unauthorized):
                _hit(spec)
    finally:
        if token:
            _auth_ctx_var.reset(token)

    assert fake_redis.writes == 0


@dataclass
class _FakeConsoleAccount:
    id: str


def _as_console_account(monkeypatch: pytest.MonkeyPatch, account_id: str | None) -> None:
    account = _FakeConsoleAccount(id=account_id) if account_id else None
    monkeypatch.setattr("libs.login.current_account_with_tenant_optional", lambda: (account, None))


def test_console_account_scope_keys_differ_per_account(
    app: Flask, fake_redis: _FakeZsetRedis, monkeypatch: pytest.MonkeyPatch
) -> None:
    with app.test_request_context("/"):
        _as_console_account(monkeypatch, "account-1")
        _hit(LIMIT_DEVICE_FLOW_APPROVE)
        _as_console_account(monkeypatch, "account-2")
        _hit(LIMIT_DEVICE_FLOW_APPROVE)

    prefix = limiter_prefix(LIMIT_DEVICE_FLOW_APPROVE)
    assert set(fake_redis.zsets) == {f"{prefix}:console_account:account-1", f"{prefix}:console_account:account-2"}


@pytest.mark.usefixtures("fake_redis")
def test_console_account_scope_limits_each_account_separately(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    with app.test_request_context("/"):
        _as_console_account(monkeypatch, "account-1")
        for _ in range(LIMIT_DEVICE_FLOW_APPROVE.limit):
            _hit(LIMIT_DEVICE_FLOW_APPROVE)
        with pytest.raises(TooManyRequests):
            _hit(LIMIT_DEVICE_FLOW_APPROVE)

        _as_console_account(monkeypatch, "account-2")
        _hit(LIMIT_DEVICE_FLOW_APPROVE)


def test_console_account_scope_without_account_fails_closed(
    app: Flask, fake_redis: _FakeZsetRedis, monkeypatch: pytest.MonkeyPatch
) -> None:
    _as_console_account(monkeypatch, None)
    with app.test_request_context("/"):
        with pytest.raises(Unauthorized):
            _hit(LIMIT_DEVICE_FLOW_APPROVE)

    assert fake_redis.writes == 0


def test_session_scope_is_gone() -> None:
    assert "session" not in {scope.value for scope in RateLimitScope}
    assert RateLimitScope.CONSOLE_ACCOUNT.value == "console_account"
