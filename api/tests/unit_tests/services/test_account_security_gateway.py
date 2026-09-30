"""Tests for shared account email security infrastructure."""

import logging
from typing import cast
from unittest.mock import Mock, call

import pytest
from redis import RedisError

from extensions.ext_redis import RedisClientWrapper
from services.account_security_gateway import RedisAccountEmailSecurityGateway


class FailingRedis:
    def get(self, _key: str) -> None:
        raise RedisError("offline")

    def delete(self, _key: str) -> None:
        raise RedisError("offline")


@pytest.fixture
def gateway() -> RedisAccountEmailSecurityGateway:
    return RedisAccountEmailSecurityGateway(
        redis=cast(RedisClientWrapper, FailingRedis()),
        email_send_ip_limit_per_minute=3,
        verification_failure_limit=5,
        verification_lockout_duration=3600,
        verification_key_prefix="forgot_password_error_rate_limit",
    )


def test_redis_failures_remain_fail_open_but_are_logged(
    gateway: RedisAccountEmailSecurityGateway,
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING, logger="services.account_security_gateway"):
        assert gateway.is_ip_limited("127.0.0.1") is False
        assert gateway.is_verification_limited("user@example.com") is False
        gateway.record_verification_failure("user@example.com")
        gateway.reset_verification_failures("user@example.com")

    assert [record.getMessage() for record in caplog.records] == [
        "Redis unavailable while checking the account email IP limit",
        "Redis unavailable while checking the account email verification limit",
        "Redis unavailable while recording an account email verification failure",
        "Redis unavailable while resetting account email verification failures",
    ]


@pytest.mark.parametrize("already_frozen", [True, False], ids=["frozen-ip", "lost-hour-counter-race"])
def test_frozen_ip_and_concurrent_hour_claim_remain_limited(already_frozen: bool) -> None:
    redis = Mock(spec=RedisClientWrapper)
    values = (
        {"email_send_ip_limit_freeze:127.0.0.1": b"1"}
        if already_frozen
        else {"email_send_ip_limit_minute:127.0.0.1": b"4"}
    )
    redis.get.side_effect = values.get
    redis.set.return_value = False
    gateway = RedisAccountEmailSecurityGateway(
        redis=redis,
        email_send_ip_limit_per_minute=3,
        verification_failure_limit=5,
        verification_lockout_duration=3600,
        verification_key_prefix="forgot_password_error_rate_limit",
    )

    assert gateway.is_ip_limited("127.0.0.1") is True

    if already_frozen:
        redis.get.assert_called_once_with("email_send_ip_limit_freeze:127.0.0.1")
        redis.set.assert_not_called()
        redis.setex.assert_not_called()
    else:
        assert redis.get.call_args_list == [
            call("email_send_ip_limit_freeze:127.0.0.1"),
            call("email_send_ip_limit_minute:127.0.0.1"),
            call("email_send_ip_limit_hour:127.0.0.1"),
        ]
        redis.set.assert_called_once_with("email_send_ip_limit_hour:127.0.0.1", 1, ex=600, nx=True)
        redis.setex.assert_called_once_with("email_send_ip_limit_freeze:127.0.0.1", 3600, 1)
    redis.expire.assert_not_called()
