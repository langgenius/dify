from unittest.mock import MagicMock, patch

from extensions.ext_redis import RedisClientWrapper
from services.account_change_email_adapters import (
    BillingAccountEmailPolicyGateway,
    RedisChangeEmailSecurityGateway,
    TokenManagerChangeEmailTokenGateway,
)
from services.entities.account_entities import AccountChangeEmailNewEmailToken


def test_billing_email_policy_preserves_suspended_domain_reason() -> None:
    gateway = BillingAccountEmailPolicyGateway(billing_enabled=True)

    with (
        patch("services.account_change_email_adapters.BillingService.is_email_in_freeze", return_value=True),
        patch(
            "services.account_change_email_adapters.BillingService.get_email_freeze_type",
            return_value="email_domain_suspended",
        ),
    ):
        assert gateway.is_frozen("user@suspended.example") == "email_domain_suspended"


def test_token_gateway_rejects_payload_without_account_binding() -> None:
    gateway = TokenManagerChangeEmailTokenGateway()

    with patch(
        "services.account_change_email_adapters.TokenManager.get_token_data",
        return_value={
            "token_type": "change_email",
            "email": "new@example.com",
            "old_email": "old@example.com",
            "code": "123456",
            "email_change_phase": "new_email",
        },
    ):
        assert gateway.get("token") is None


def test_token_gateway_issues_account_bound_state() -> None:
    gateway = TokenManagerChangeEmailTokenGateway()
    token_data = AccountChangeEmailNewEmailToken(
        account_id="account-1",
        email="new@example.com",
        old_email="old@example.com",
        code="123456",
    )

    with patch(
        "services.account_change_email_adapters.TokenManager.generate_token",
        return_value="token",
    ) as generate_token:
        assert gateway.issue(token_data) == "token"

    assert generate_token.call_args.kwargs["account_id"] == "account-1"
    assert generate_token.call_args.kwargs["email"] == "new@example.com"
    assert generate_token.call_args.kwargs["additional_data"] == {
        "old_email": "old@example.com",
        "code": "123456",
        "email_change_phase": "new_email",
    }


def test_security_gateway_counts_normal_ip_request() -> None:
    redis = MagicMock(spec=RedisClientWrapper)
    redis.get.side_effect = [None, None]
    gateway = RedisChangeEmailSecurityGateway(
        redis=redis,
        email_send_ip_limit_per_minute=60,
        verification_failure_limit=5,
        verification_lockout_duration=600,
    )

    assert gateway.is_ip_limited("127.0.0.1") is False

    redis.setex.assert_called_once_with("email_send_ip_limit_minute:127.0.0.1", 60, 1)
    redis.expire.assert_called_once_with("email_send_ip_limit_minute:127.0.0.1", 60)


def test_security_gateway_freezes_second_over_limit_ip_strike() -> None:
    redis = MagicMock(spec=RedisClientWrapper)
    redis.get.side_effect = [None, 2, 1]
    gateway = RedisChangeEmailSecurityGateway(
        redis=redis,
        email_send_ip_limit_per_minute=1,
        verification_failure_limit=5,
        verification_lockout_duration=600,
    )

    assert gateway.is_ip_limited("127.0.0.1") is True

    redis.setex.assert_called_once_with("email_send_ip_limit_freeze:127.0.0.1", 3600, 1)
