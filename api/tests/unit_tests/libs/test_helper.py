import json
from collections.abc import Callable
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, call, create_autospec

import pytest
from flask import request
from pydantic import ValidationError

import libs.helper as _token_manager_helper_module
from dify_app import DifyApp
from extensions import ext_proxy_fix
from extensions.ext_redis import RedisClientWrapper
from libs import helper as _rate_limiter_helper_module
from libs import rate_limit as rate_limit_module
from libs.helper import (
    OptionalTimestampField,
    RateLimiter,
    TokenManager,
    alphanumeric,
    email,
    escape_like_pattern,
    extract_remote_ip,
    extract_tenant_id,
)
from models.account import Account
from models.model import EndUser


def test_email_with_valid_email() -> None:
    assert email("test@example.com") == "test@example.com"
    assert email("TEST12345@example.com") == "TEST12345@example.com"
    assert email("test+test@example.com") == "test+test@example.com"
    assert email("!#$%&'*+-/=?^_{|}~`@example.com") == "!#$%&'*+-/=?^_{|}~`@example.com"


def test_email_with_invalid_email() -> None:
    with pytest.raises(ValueError, match="invalid_email is not a valid email."):
        email("invalid_email")

    with pytest.raises(ValueError, match="@example.com is not a valid email."):
        email("@example.com")

    with pytest.raises(ValueError, match="()@example.com is not a valid email."):
        email("()@example.com")


@pytest.mark.parametrize(
    ("trust_proxy", "headers", "expected_ips", "expected_statuses"),
    [
        pytest.param(
            False,
            [
                {},
                {"CF-Connecting-IP": "203.0.113.1"},
                {"X-Forwarded-For": "203.0.113.2, 192.0.2.42"},
            ],
            ["198.51.100.7"] * 3,
            [200, 429, 429],
            id="direct-client-ignores-untrusted-headers",
        ),
        pytest.param(
            True,
            [
                {"CF-Connecting-IP": "203.0.113.1", "X-Forwarded-For": "192.0.2.42"},
                {"CF-Connecting-IP": "203.0.113.2", "X-Forwarded-For": "203.0.113.3, 192.0.2.42"},
            ],
            ["192.0.2.42"] * 2,
            [200, 429],
            id="spoofed-headers-cannot-change-trusted-ip-bucket",
        ),
        pytest.param(
            True,
            [{"X-Forwarded-For": "192.0.2.42"}, {"X-Forwarded-For": "192.0.2.43"}],
            ["192.0.2.42", "192.0.2.43"],
            [200, 200],
            id="canonical-visitors-have-distinct-buckets",
        ),
        pytest.param(
            True,
            [{"CF-Connecting-IP": "203.0.113.1"}, {"CF-Connecting-IP": "203.0.113.2"}],
            ["198.51.100.7"] * 2,
            [200, 429],
            id="cloudflare-header-alone-is-not-trusted",
        ),
    ],
)
def test_extract_remote_ip_preserves_trusted_rate_limit_buckets(
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
    trust_proxy: bool,
    headers: list[dict[str, str]],
    expected_ips: list[str],
    expected_statuses: list[int],
) -> None:
    config_overrides(RESPECT_XFORWARD_HEADERS_ENABLED=trust_proxy)
    app = DifyApp(__name__)
    ext_proxy_fix.init_app(app)
    used_keys: set[str] = set()
    limiter = create_autospec(RateLimiter, instance=True, spec_set=True)
    limiter.is_rate_limited.side_effect = lambda key: key in used_keys
    limiter.increment_rate_limit.side_effect = used_keys.add
    monkeypatch.setattr(rate_limit_module, "_build_limiter", lambda _spec: limiter)

    @app.get("/")
    @rate_limit_module.rate_limit(
        rate_limit_module.RateLimit(limit=1, window=timedelta(minutes=1), scopes=(rate_limit_module.RateLimitScope.IP,))
    )
    def remote_ip() -> str:
        return extract_remote_ip(request)

    client = app.test_client()
    for request_headers, expected_ip, expected_status in zip(headers, expected_ips, expected_statuses, strict=True):
        response = client.get("/", headers=request_headers, environ_overrides={"REMOTE_ADDR": "198.51.100.7"})
        assert response.status_code == expected_status
        if expected_status == 200:
            assert response.get_data(as_text=True) == expected_ip

    assert limiter.is_rate_limited.call_args_list == [call(f"ip:{ip}") for ip in expected_ips]


class TestExtractTenantId:
    """Test cases for the extract_tenant_id utility function."""

    def test_extract_tenant_id_from_account_with_tenant(self):
        """Test extracting tenant_id from Account with current_tenant_id."""
        # Create a mock Account object
        account = Account(name="test", email="test@example.com")
        # Mock the current_tenant_id property
        account._current_tenant = type("MockTenant", (), {"id": "account-tenant-123"})()

        tenant_id = extract_tenant_id(account)
        assert tenant_id == "account-tenant-123"

    def test_extract_tenant_id_from_account_without_tenant(self):
        """Test extracting tenant_id from Account without current_tenant_id."""
        # Create a mock Account object
        account = Account(name="test", email="test@example.com")
        account._current_tenant = None

        tenant_id = extract_tenant_id(account)
        assert tenant_id is None

    def test_extract_tenant_id_from_enduser_with_tenant(self):
        """Test extracting tenant_id from EndUser with tenant_id."""
        # Create a mock EndUser object
        end_user = EndUser()
        end_user.tenant_id = "enduser-tenant-456"

        tenant_id = extract_tenant_id(end_user)
        assert tenant_id == "enduser-tenant-456"

    def test_extract_tenant_id_from_enduser_without_tenant(self):
        """Test extracting tenant_id from EndUser without tenant_id."""
        # Create a mock EndUser object
        end_user = EndUser()
        end_user.tenant_id = None

        tenant_id = extract_tenant_id(end_user)
        assert tenant_id is None

    def test_extract_tenant_id_with_invalid_user_type(self):
        """Test extracting tenant_id with invalid user type raises ValueError."""
        invalid_user = "not_a_user_object"

        with pytest.raises(ValueError, match="Invalid user type.*Expected Account or EndUser"):
            extract_tenant_id(invalid_user)

    def test_extract_tenant_id_with_none_user(self):
        """Test extracting tenant_id with None user raises ValueError."""
        with pytest.raises(ValueError, match="Invalid user type.*Expected Account or EndUser"):
            extract_tenant_id(None)

    def test_extract_tenant_id_with_dict_user(self):
        """Test extracting tenant_id with dict user raises ValueError."""
        dict_user = {"id": "123", "tenant_id": "456"}

        with pytest.raises(ValueError, match="Invalid user type.*Expected Account or EndUser"):
            extract_tenant_id(dict_user)


class TestOptionalTimestampField:
    def test_format_returns_none_for_none(self):
        field = OptionalTimestampField()

        assert field.format(None) is None

    def test_format_returns_unix_timestamp_for_datetime(self):
        field = OptionalTimestampField()
        value = datetime(2024, 1, 2, 3, 4, 5)

        assert field.format(value) == int(value.timestamp())


class TestEscapeLikePattern:
    """Test cases for the escape_like_pattern utility function."""

    def test_escape_percent_character(self):
        """Test escaping percent character."""
        result = escape_like_pattern("50% discount")
        assert result == "50\\% discount"

    def test_escape_underscore_character(self):
        """Test escaping underscore character."""
        result = escape_like_pattern("test_data")
        assert result == "test\\_data"

    def test_escape_backslash_character(self):
        """Test escaping backslash character."""
        result = escape_like_pattern("path\\to\\file")
        assert result == "path\\\\to\\\\file"

    def test_escape_combined_special_characters(self):
        """Test escaping multiple special characters together."""
        result = escape_like_pattern("file_50%\\path")
        assert result == "file\\_50\\%\\\\path"

    def test_escape_empty_string(self):
        """Test escaping empty string returns empty string."""
        result = escape_like_pattern("")
        assert result == ""

    def test_escape_none_handling(self):
        """Test escaping None returns None (falsy check handles it)."""
        # The function checks `if not pattern`, so None is falsy and returns as-is
        result = escape_like_pattern(None)
        assert result is None

    def test_escape_normal_string_no_change(self):
        """Test that normal strings without special characters are unchanged."""
        result = escape_like_pattern("normal text")
        assert result == "normal text"

    def test_escape_order_matters(self):
        """Test that backslash is escaped first to prevent double escaping."""
        # If we escape % first, then escape \, we might get wrong results
        # This test ensures the order is correct: \ first, then % and _
        result = escape_like_pattern("test\\%_value")
        # Should be: test\\\%\_value
        assert result == "test\\\\\\%\\_value"


class TestEmailValidator:
    """Tests for the email() validator — regression for #39234."""

    def test_valid_email_accepted(self):
        assert email("user@example.com") == "user@example.com"

    def test_trailing_newline_rejected(self):
        with pytest.raises(ValueError, match="not a valid email"):
            email("user@example.com\n")

    def test_trailing_carriage_return_newline_rejected(self):
        with pytest.raises(ValueError, match="not a valid email"):
            email("user@example.com\r\n")

    def test_multiple_newlines_rejected(self):
        with pytest.raises(ValueError, match="not a valid email"):
            email("user@example.com\n\n")

    def test_empty_string_rejected(self):
        with pytest.raises(ValueError, match="not a valid email"):
            email("")

    def test_invalid_email_rejected(self):
        with pytest.raises(ValueError, match="not a valid email"):
            email("not-an-email")


class TestAlphanumericValidator:
    """Tests for the alphanumeric() validator — regression for #39666."""

    def test_valid_alphanumeric_accepted(self):
        assert alphanumeric("tool_name") == "tool_name"
        assert alphanumeric("Tool123") == "Tool123"
        assert alphanumeric("_underscore_start") == "_underscore_start"
        assert alphanumeric("a") == "a"

    def test_trailing_newline_rejected(self):
        # re.match with $ accepts a trailing \n in Python; re.fullmatch does not.
        # This was the pre-fix behaviour: alphanumeric("tool\n") returned "tool\n".
        with pytest.raises(ValueError, match="not a valid alphanumeric value"):
            alphanumeric("tool_name\n")

    def test_trailing_carriage_return_rejected(self):
        with pytest.raises(ValueError, match="not a valid alphanumeric value"):
            alphanumeric("tool_name\r")

    def test_trailing_crlf_rejected(self):
        with pytest.raises(ValueError, match="not a valid alphanumeric value"):
            alphanumeric("tool_name\r\n")

    def test_leading_newline_rejected(self):
        with pytest.raises(ValueError, match="not a valid alphanumeric value"):
            alphanumeric("\ntool_name")

    def test_embedded_whitespace_rejected(self):
        with pytest.raises(ValueError, match="not a valid alphanumeric value"):
            alphanumeric("tool name")

    def test_empty_string_rejected(self):
        with pytest.raises(ValueError, match="not a valid alphanumeric value"):
            alphanumeric("")

    def test_special_characters_rejected(self):
        with pytest.raises(ValueError, match="not a valid alphanumeric value"):
            alphanumeric("tool-name")
        with pytest.raises(ValueError, match="not a valid alphanumeric value"):
            alphanumeric("tool.name")
        with pytest.raises(ValueError, match="not a valid alphanumeric value"):
            alphanumeric("tool/name")


class _FakeRedis:
    def __init__(self) -> None:
        self._zsets: dict[str, dict[str, float]] = {}
        self._expiry: dict[str, int] = {}

    def zadd(self, key: str, mapping: dict[str, float]) -> int:
        zset = self._zsets.setdefault(key, {})
        for member, score in mapping.items():
            zset[member] = float(score)
        return len(mapping)

    def zremrangebyscore(self, key: str, min_score: str | float, max_score: str | float) -> int:
        zset = self._zsets.get(key, {})
        min_value = float("-inf") if min_score == "-inf" else float(min_score)
        max_value = float("inf") if max_score == "+inf" else float(max_score)
        to_delete = [member for member, score in zset.items() if min_value <= score <= max_value]
        for member in to_delete:
            del zset[member]
        return len(to_delete)

    def zcard(self, key: str) -> int:
        return len(self._zsets.get(key, {}))

    def expire(self, key: str, ttl: int) -> bool:
        self._expiry[key] = ttl
        return True


def test_rate_limiter_counts_attempts_within_same_second(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_redis = _FakeRedis()
    monkeypatch.setattr(_rate_limiter_helper_module.time, "time", lambda: 1000)

    limiter = _rate_limiter_helper_module.RateLimiter(
        prefix="test_rate_limit",
        max_attempts=2,
        time_window=60,
        redis_client=cast(_rate_limiter_helper_module._RateLimiterRedisClient, fake_redis),
    )

    limiter.increment_rate_limit("203.0.113.10")
    limiter.increment_rate_limit("203.0.113.10")

    assert limiter.is_rate_limited("203.0.113.10") is True


def test_rate_limiter_uses_injected_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    redis_client = MagicMock()
    redis_client.zcard.return_value = 1
    monkeypatch.setattr(_rate_limiter_helper_module.time, "time", lambda: 1000)

    limiter = _rate_limiter_helper_module.RateLimiter(
        prefix="test_rate_limit",
        max_attempts=1,
        time_window=60,
        redis_client=redis_client,
    )

    limiter.increment_rate_limit("203.0.113.10")
    limiter.is_rate_limited("203.0.113.10")

    assert redis_client.zadd.called is True
    assert redis_client.zremrangebyscore.called is True
    assert redis_client.zcard.called is True


@pytest.mark.parametrize("acquired", [True, False])
def test_reservation_uses_one_atomic_command_and_keeps_successful_slots(
    redis_transport: tuple[RedisClientWrapper, MagicMock], monkeypatch: pytest.MonkeyPatch, acquired: bool
) -> None:
    redis, commands = redis_transport
    commands.return_value = int(acquired)
    monkeypatch.setattr(_rate_limiter_helper_module.time, "time", lambda: 1000)
    limiter = _rate_limiter_helper_module.RateLimiter(
        prefix="reset", max_attempts=1, time_window=60, member_factory=lambda: "reservation", redis_client=redis
    )

    with limiter.reserve("user@example.com") as allowed:
        assert allowed is acquired

    assert commands.call_count == 1
    assert commands.call_args.args[0] == "EVALSHA"
    assert commands.call_args.args[2:] == (1, "reset:user@example.com", 1000, 60, 1, "reservation")


@pytest.mark.parametrize("acquired", [True, False])
def test_failed_reservation_releases_only_its_own_slot(
    redis_transport: tuple[RedisClientWrapper, MagicMock], acquired: bool
) -> None:
    redis, commands = redis_transport
    commands.return_value = int(acquired)
    limiter = _rate_limiter_helper_module.RateLimiter(
        prefix="reset", max_attempts=1, time_window=60, member_factory=lambda: "reservation", redis_client=redis
    )

    with pytest.raises(RuntimeError, match="delivery failed"), limiter.reserve("user@example.com"):
        raise RuntimeError("delivery failed")

    assert commands.call_count == (2 if acquired else 1)
    if acquired:
        assert commands.call_args.args == ("ZREM", "reset:user@example.com", "reservation")


def test_reservation_cleanup_does_not_hide_delivery_error(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    redis, commands = redis_transport
    commands.side_effect = [1, ConnectionError("redis unavailable")]
    limiter = _rate_limiter_helper_module.RateLimiter(
        prefix="reset", max_attempts=1, time_window=60, redis_client=redis
    )

    with pytest.raises(RuntimeError, match="delivery failed"), limiter.reserve("user@example.com"):
        raise RuntimeError("delivery failed")


def test_reservation_redis_failure_stops_the_operation(redis_transport: tuple[RedisClientWrapper, MagicMock]) -> None:
    redis, commands = redis_transport
    commands.side_effect = ConnectionError("redis unavailable")
    limiter = _rate_limiter_helper_module.RateLimiter(
        prefix="reset", max_attempts=1, time_window=60, redis_client=redis
    )

    with pytest.raises(ConnectionError, match="redis unavailable"), limiter.reserve("user@example.com"):
        pytest.fail("Operation must not run without acquiring a slot")


"""
Regression tests for `libs.helper.TokenManager`.

`TokenManager` is the storage primitive shared by multiple auth flows, so it
must preserve every metadata field written by the caller. Business-specific
validation now happens at the callsite boundary (for example,
`TokenManagerChangeEmailTokenGateway.read`), not inside `TokenManager`.
"""


def _build_fake_redis(storage: dict[str, str]) -> SimpleNamespace:
    def store_value(key: str, _ttl: int, value: str) -> bool:
        storage[key] = value
        return True

    def load_value(key: str) -> str | None:
        return storage.get(key)

    return SimpleNamespace(
        setex=store_value,
        get=load_value,
        delete=lambda *_args, **_kwargs: None,
    )


def test_token_manager_roundtrip_preserves_untyped_metadata_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    """`TokenManager` must round-trip arbitrary metadata keys without silently
    dropping fields such as `phase`, `email_change_phase`, or future auth
    payload extensions.
    """

    storage: dict[str, str] = {}
    monkeypatch.setattr(_token_manager_helper_module, "redis_client", _build_fake_redis(storage))

    token = TokenManager.generate_token(
        email="user@example.com",
        token_type="change_email",
        additional_data={
            "code": "654321",
            "old_email": "old@example.com",
            "phase": "legacy-phase",
            "email_change_phase": "old_email",
            "custom_marker": "preserve-me",
        },
    )

    data = TokenManager.get_token_data(token, "change_email")

    assert data is not None
    assert data.get("phase") == "legacy-phase"
    assert data.get("email_change_phase") == "old_email"
    assert data.get("custom_marker") == "preserve-me"


def test_token_manager_roundtrip_uses_explicit_account_id(monkeypatch: pytest.MonkeyPatch) -> None:
    """When both `account_id` and `email` are supplied, the token should bind
    both primitive values without depending on an account model.
    """

    storage: dict[str, str] = {}
    monkeypatch.setattr(_token_manager_helper_module, "redis_client", _build_fake_redis(storage))

    token = TokenManager.generate_token(
        account_id="acc-1",
        email="new@example.com",
        token_type="change_email",
        additional_data={
            "code": "654321",
            "old_email": "old@example.com",
            "email_change_phase": "new_email",
        },
    )

    data = TokenManager.get_token_data(token, "change_email")

    assert data is not None
    assert data.get("account_id") == "acc-1"
    assert data.get("email") == "new@example.com"
    assert data.get("old_email") == "old@example.com"
    assert data.get("email_change_phase") == "new_email"


def test_token_manager_roundtrip_still_validates_declared_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    """Unknown fields should be preserved, but declared baseline fields should
    still be validated by `_token_data_adapter`.
    """

    storage = {
        "change_email:token:token-123": json.dumps(
            {
                "token_type": "change_email",
                "account_id": "acc-1",
                "email": ["not-a-string"],
                "code": "654321",
                "old_email": "old@example.com",
                "email_change_phase": "old_email",
            }
        )
    }
    monkeypatch.setattr(_token_manager_helper_module, "redis_client", _build_fake_redis(storage))

    with pytest.raises(ValidationError):
        TokenManager.get_token_data("token-123", "change_email")


def test_token_manager_roundtrip_validates_email_change_phase_as_string(monkeypatch: pytest.MonkeyPatch) -> None:
    """`email_change_phase` is part of the shared baseline schema, so obviously
    malformed discriminator values should fail before the change-email-specific
    union parsing at the callsite boundary.
    """

    storage = {
        "change_email:token:token-456": json.dumps(
            {
                "token_type": "change_email",
                "account_id": "acc-1",
                "email": "new@example.com",
                "code": "654321",
                "old_email": "old@example.com",
                "email_change_phase": ["not-a-string"],
            }
        )
    }
    monkeypatch.setattr(_token_manager_helper_module, "redis_client", _build_fake_redis(storage))

    with pytest.raises(ValidationError):
        TokenManager.get_token_data("token-456", "change_email")
