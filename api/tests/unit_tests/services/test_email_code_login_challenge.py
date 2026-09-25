import json
from collections.abc import Iterator
from unittest.mock import MagicMock, patch

import pytest
from redis.exceptions import ConnectionError

from services.email_code_login_challenge import (
    EmailCodeLoginChallengeStatus,
    EmailCodeLoginChallengeStore,
    EmailCodeLoginChallengeUnavailableError,
)
from tests.unit_tests.config_override import apply_config_overrides

TOKEN = "00000000-0000-4000-8000-000000000001"


@pytest.fixture
def challenge_redis() -> Iterator[MagicMock]:
    with patch("services.email_code_login_challenge.redis_client") as mock_redis:
        yield mock_redis


@pytest.fixture
def verify_challenge() -> Iterator[MagicMock]:
    with patch("services.email_code_login_challenge._verify_challenge") as script:
        yield script


@pytest.fixture
def verify_legacy_token() -> Iterator[MagicMock]:
    with patch("services.email_code_login_challenge._verify_legacy_token") as script:
        yield script


def test_create_stores_only_one_per_email_v2_challenge(
    challenge_redis: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    apply_config_overrides(
        monkeypatch,
        EMAIL_CODE_LOGIN_MAX_ATTEMPTS=5,
        EMAIL_CODE_LOGIN_TOKEN_EXPIRY_MINUTES=5,
    )

    with patch("services.email_code_login_challenge.uuid.uuid4", return_value=TOKEN):
        token = EmailCodeLoginChallengeStore.create(
            email="User@Example.com",
            code="123456",
            account_id="account-id",
        )

    assert token == TOKEN
    challenge_key, ttl, serialized_payload = challenge_redis.setex.call_args.args
    assert challenge_key == EmailCodeLoginChallengeStore._challenge_key("user@example.com")
    assert ttl == 300
    assert json.loads(serialized_payload) == {
        "account_id": "account-id",
        "email": "user@example.com",
        "token_type": "email_code_login",
        "code": "123456",
        "remaining_attempts": 5,
        "challenge_version": 2,
        "state": "active",
        "token": TOKEN,
    }
    assert challenge_key != f"email_code_login:token:{TOKEN}"
    challenge_redis.set.assert_not_called()
    challenge_redis.delete.assert_not_called()


def test_verify_current_challenge_decrements_budget_without_refreshing_ttl(
    challenge_redis: MagicMock, verify_challenge: MagicMock, verify_legacy_token: MagicMock
) -> None:
    verify_challenge.return_value = [3, 4]

    result = EmailCodeLoginChallengeStore.verify(
        email="User@Example.com",
        code="654321",
        token=TOKEN,
    )

    assert result.status is EmailCodeLoginChallengeStatus.INVALID_CODE
    assert result.remaining_attempts == 4
    verify_challenge.assert_called_once_with(
        challenge_redis,
        challenge_key=EmailCodeLoginChallengeStore._challenge_key("user@example.com"),
        token_type="email_code_login",
        token=TOKEN,
        email="user@example.com",
        code="654321",
        challenge_version=2,
    )
    verify_legacy_token.assert_not_called()
    challenge_redis.set.assert_not_called()
    challenge_redis.expire.assert_not_called()


@pytest.mark.parametrize(
    ("lua_response", "expected_status"),
    [
        ([1, -1], EmailCodeLoginChallengeStatus.INVALID_TOKEN),
        ([2, -1], EmailCodeLoginChallengeStatus.EMAIL_MISMATCH),
        ([4, -1], EmailCodeLoginChallengeStatus.VERIFIED),
        ([6, 0], EmailCodeLoginChallengeStatus.EXHAUSTED),
        ([8, -1], EmailCodeLoginChallengeStatus.INVALID_TOKEN),
    ],
)
def test_verify_maps_v2_lua_result(
    verify_challenge: MagicMock,
    verify_legacy_token: MagicMock,
    lua_response: list[int],
    expected_status: EmailCodeLoginChallengeStatus,
) -> None:
    verify_challenge.return_value = lua_response

    result = EmailCodeLoginChallengeStore.verify(
        email="user@example.com",
        code="123456",
        token=TOKEN,
    )

    assert result.status is expected_status
    verify_challenge.assert_called_once()
    verify_legacy_token.assert_not_called()


def test_terminal_v2_challenge_blocks_pre_rollout_legacy_token_fallback(
    verify_challenge: MagicMock, verify_legacy_token: MagicMock
) -> None:
    legacy_token = "00000000-0000-4000-8000-000000000002"
    verify_challenge.return_value = [8, -1]

    result = EmailCodeLoginChallengeStore.verify(
        email="user@example.com",
        code="111111",
        token=legacy_token,
    )

    assert result.status is EmailCodeLoginChallengeStatus.INVALID_TOKEN
    verify_challenge.assert_called_once()
    verify_legacy_token.assert_not_called()


def test_verify_supports_unversioned_token_created_before_rollout(
    challenge_redis: MagicMock, verify_challenge: MagicMock, verify_legacy_token: MagicMock
) -> None:
    verify_challenge.return_value = [0, -1]
    verify_legacy_token.return_value = [4, -1]

    result = EmailCodeLoginChallengeStore.verify(
        email="user@example.com",
        code="123456",
        token=TOKEN,
    )

    assert result.status is EmailCodeLoginChallengeStatus.VERIFIED
    verify_legacy_token.assert_called_once_with(
        challenge_redis,
        token_key=f"email_code_login:token:{TOKEN}",
        token_type="email_code_login",
        email="user@example.com",
        code="123456",
        max_attempts=5,
    )


def test_verify_rejects_versioned_payload_in_legacy_fallback(
    verify_challenge: MagicMock, verify_legacy_token: MagicMock
) -> None:
    verify_challenge.return_value = [0, -1]
    verify_legacy_token.return_value = [7, -1]

    result = EmailCodeLoginChallengeStore.verify(
        email="user@example.com",
        code="123456",
        token=TOKEN,
    )

    assert result.status is EmailCodeLoginChallengeStatus.INVALID_TOKEN


def test_create_fails_closed_on_redis_error(challenge_redis: MagicMock) -> None:
    challenge_redis.setex.side_effect = ConnectionError("redis unavailable")

    with pytest.raises(EmailCodeLoginChallengeUnavailableError):
        EmailCodeLoginChallengeStore.create(
            email="user@example.com",
            code="123456",
            account_id=None,
        )


def test_verify_fails_closed_on_redis_error(verify_challenge: MagicMock) -> None:
    verify_challenge.side_effect = ConnectionError("redis unavailable")

    with pytest.raises(EmailCodeLoginChallengeUnavailableError):
        EmailCodeLoginChallengeStore.verify(
            email="user@example.com",
            code="123456",
            token=TOKEN,
        )


def test_verify_fails_closed_on_unexpected_lua_response(verify_challenge: MagicMock) -> None:
    verify_challenge.return_value = None

    with pytest.raises(EmailCodeLoginChallengeUnavailableError):
        EmailCodeLoginChallengeStore.verify(
            email="user@example.com",
            code="123456",
            token=TOKEN,
        )
