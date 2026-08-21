from unittest.mock import MagicMock, patch

import pytest

from libs.helper import RateLimiter
from services.account_deletion_adapters import (
    CeleryAccountDeletionVerificationNotifier,
    TokenManagerAccountDeletionVerificationGateway,
)
from services.account_errors import AccountDeletionRateLimitError


def test_verification_gateway_binds_token_to_the_target_account() -> None:
    gateway = TokenManagerAccountDeletionVerificationGateway()

    with patch(
        "services.account_deletion_adapters.TokenManager.get_token_data",
        return_value={"account_id": "account-1", "code": "123456"},
    ):
        assert gateway.verify(account_id="account-1", token="token", code="123456") is True
        assert gateway.verify(account_id="account-2", token="token", code="123456") is False


def test_verification_gateway_creates_six_digit_account_bound_challenge() -> None:
    gateway = TokenManagerAccountDeletionVerificationGateway()

    with (
        patch("services.account_deletion_adapters.secrets.randbelow", side_effect=[1, 2, 3, 4, 5, 6]),
        patch(
            "services.account_deletion_adapters.TokenManager.generate_token",
            return_value="token",
        ) as generate_token,
    ):
        challenge = gateway.create(account_id="account-1", email="account@example.com")

    assert challenge.token == "token"
    assert challenge.code == "123456"
    assert generate_token.call_args.kwargs["account_id"] == "account-1"
    assert generate_token.call_args.kwargs["email"] == "account@example.com"
    assert generate_token.call_args.kwargs["additional_data"] == {"code": "123456"}


def test_verification_notifier_preserves_rate_limit_before_enqueuing_email() -> None:
    limiter = MagicMock(spec=RateLimiter)
    limiter.is_rate_limited.return_value = True
    limiter.time_window = 60
    notifier = CeleryAccountDeletionVerificationNotifier(rate_limiter=limiter)

    with (
        patch("services.account_deletion_adapters.send_account_deletion_verification_code") as mail_task,
        pytest.raises(AccountDeletionRateLimitError) as error,
    ):
        notifier.send(email="account@example.com", code="123456")

    assert error.value.retry_after_minutes == 1
    mail_task.delay.assert_not_called()
