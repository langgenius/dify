"""Tests for shared account email security infrastructure."""

import logging
from typing import cast

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
