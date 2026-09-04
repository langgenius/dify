"""Tests for forgot-password infrastructure adapters."""

import json
from typing import cast

import pytest

from extensions.ext_redis import RedisClientWrapper
from services.account_forgot_password_adapters import RedisForgotPasswordTokenGateway
from services.entities.account_entities import ForgotPasswordResetToken, ForgotPasswordVerificationToken


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, object] = {}

    def getdel(self, key: str) -> object | None:
        return self.values.pop(key, None)

    def get(self, key: str) -> object | None:
        return self.values.get(key)

    def setex(self, key: str, _seconds: int, value: object) -> bool:
        self.values[key] = value
        return True

    def delete(self, key: str) -> int:
        return int(self.values.pop(key, None) is not None)

    def eval(
        self,
        _script: str,
        _key_count: int,
        key: str,
        expected: str,
        *args: object,
    ) -> int:
        if self.values.get(key) != expected:
            return 0
        replacement, _expiry_seconds = args
        self.values[key] = replacement
        return 1


def _gateway(redis: FakeRedis | None = None) -> RedisForgotPasswordTokenGateway:
    return RedisForgotPasswordTokenGateway(
        redis=cast(RedisClientWrapper, redis or FakeRedis()),
        expiry_seconds=300,
    )


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "User@Example.com", "code": "123456", "phase": "reset"},
        {"email": "user@example.com", "code": "123456", "phase": "unknown"},
        {"email": None, "code": "123456"},
    ],
)
def test_token_gateway_read_verification_rejects_other_payloads_without_consuming(
    payload: dict[str, object],
) -> None:
    redis = FakeRedis()
    redis.values["reset_password:token:token"] = json.dumps(payload)

    assert _gateway(redis).read_verification("token") is None
    assert "reset_password:token:token" in redis.values


def test_token_gateway_reads_verification_token_without_consuming() -> None:
    redis = FakeRedis()
    redis.values["reset_password:token:token"] = json.dumps({"email": "User@Example.com", "code": "123456"})
    gateway = _gateway(redis)
    expected = ForgotPasswordVerificationToken(email="User@Example.com", code="123456")

    assert gateway.read_verification("token") == expected
    assert gateway.read_verification("token") == expected


def test_token_gateway_allows_only_one_successful_reset_claim() -> None:
    redis = FakeRedis()
    redis.values["reset_password:token:token"] = json.dumps(
        {"email": "user@example.com", "code": "123456", "phase": "reset"}
    )
    gateway = _gateway(redis)

    assert isinstance(gateway.claim_reset("token"), ForgotPasswordResetToken)
    assert gateway.claim_reset("token") is None


def test_token_gateway_rejects_superseded_account_token() -> None:
    redis = FakeRedis()
    redis.values["reset_password:token:v1"] = json.dumps(
        {"account_id": "account-1", "email": "user@example.com", "code": "123456", "phase": "reset"}
    )
    redis.values["reset_password:account:account-1"] = "v2"

    assert _gateway(redis).claim_reset("v1") is None

    assert "reset_password:token:v1" not in redis.values


def test_token_gateway_serializes_reset_phase() -> None:
    redis = FakeRedis()
    token = _gateway(redis).issue(
        ForgotPasswordResetToken(email="User@Example.com", code="123456", account_id="account-1")
    )

    assert json.loads(cast(str, redis.values[f"reset_password:token:{token}"])) == {
        "token_type": "reset_password",
        "account_id": "account-1",
        "email": "User@Example.com",
        "code": "123456",
        "phase": "reset",
    }
    assert redis.values["reset_password:account:account-1"] == token


def test_token_gateway_binds_verification_token_to_existing_account() -> None:
    redis = FakeRedis()
    token = _gateway(redis).issue(
        ForgotPasswordVerificationToken(
            email="User@Example.com",
            code="123456",
            account_id="account-1",
        )
    )

    assert redis.values["reset_password:account:account-1"] == token


def test_token_gateway_promotes_only_the_current_account_token() -> None:
    redis = FakeRedis()
    current_key = "reset_password:account:account-1"
    redis.values["reset_password:token:v1"] = json.dumps(
        {"account_id": "account-1", "email": "user@example.com", "code": "123456"}
    )
    redis.values[current_key] = "v1"
    gateway = _gateway(redis)

    claimed = gateway.read_verification("v1")
    assert isinstance(claimed, ForgotPasswordVerificationToken)
    reset_token = gateway.promote("v1", claimed.promote())

    assert reset_token is not None
    assert redis.values[current_key] == reset_token
    assert "reset_password:token:v1" not in redis.values
    assert json.loads(cast(str, redis.values[f"reset_password:token:{reset_token}"]))["phase"] == "reset"


def test_token_gateway_promotion_does_not_revoke_concurrent_new_token() -> None:
    redis = FakeRedis()
    old_key = "reset_password:token:v1"
    current_key = "reset_password:account:account-1"
    redis.values[old_key] = json.dumps({"account_id": "account-1", "email": "user@example.com", "code": "123456"})
    redis.values[current_key] = "v1"
    gateway = _gateway(redis)

    claimed = gateway.read_verification("v1")
    assert isinstance(claimed, ForgotPasswordVerificationToken)
    new_token = gateway.issue(
        ForgotPasswordVerificationToken(
            email="user@example.com",
            code="654321",
            account_id="account-1",
        )
    )

    assert gateway.promote("v1", claimed.promote()) is None

    assert redis.values[current_key] == new_token
    assert old_key not in redis.values
    assert f"reset_password:token:{new_token}" in redis.values


def test_token_gateway_consumes_legacy_verification_token_when_promoting() -> None:
    redis = FakeRedis()
    old_key = "reset_password:token:legacy"
    redis.values[old_key] = json.dumps({"email": "user@example.com", "code": "123456"})
    gateway = _gateway(redis)

    claimed = gateway.read_verification("legacy")
    assert isinstance(claimed, ForgotPasswordVerificationToken)
    reset_token = gateway.promote("legacy", claimed.promote())

    assert reset_token is not None
    assert old_key not in redis.values
    assert f"reset_password:token:{reset_token}" in redis.values
