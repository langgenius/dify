from unittest.mock import Mock, patch

import pytest
from redis import RedisError
from sqlalchemy.orm import Session

from extensions.ext_redis import RedisClientWrapper
from models.account import Account
from services.account.email_registration_adapters import (
    AccountLifecycleRegistrationGateway,
    BillingAccountRegistrationPolicyGateway,
    RedisEmailRegistrationSecurityGateway,
    TokenManagerEmailRegistrationTokenGateway,
)
from services.account.login_adapters import RedisConsoleAuthSecurityGateway
from services.account.login_service import ConsoleAuthSecurityGateway
from services.account.service import AccountService
from services.account_errors import (
    AccountEmailDomainSuspendedError,
    AccountNormalizedEmailAlreadyInUseError,
    EmailRegistrationSeatsLimitError,
    SeatsLimitExceededError,
)
from services.entities.account_entities import (
    AccountEmailRegistrationPhase,
    AccountEmailRegistrationToken,
    AccountSessionTokens,
)
from tests.unit_tests.account_domain import AccountDomain


def test_token_gateway_rejects_malformed_payload() -> None:
    gateway = TokenManagerEmailRegistrationTokenGateway()

    with patch(
        "services.account.email_registration_adapters.TokenManager.get_token_data",
        return_value={"email": "user@example.com", "phase": "unknown"},
    ):
        assert gateway.get("token") is None


def test_token_gateway_issues_verified_registration_state() -> None:
    gateway = TokenManagerEmailRegistrationTokenGateway()
    token_data = AccountEmailRegistrationToken(
        email="user@example.com",
        code="123456",
        phase=AccountEmailRegistrationPhase.REGISTER,
    )

    with patch(
        "services.account.email_registration_adapters.TokenManager.generate_token",
        return_value="token",
    ) as generate_token:
        assert gateway.issue(token_data) == "token"

    generate_token.assert_called_once_with(
        email="user@example.com",
        token_type="email_register",
        additional_data={"code": "123456", "phase": "register"},
    )


@pytest.mark.parametrize(("count", "limited"), [(0, False), (1, False), (2, True)])
def test_security_gateway_preserves_shared_ip_limit(monkeypatch: pytest.MonkeyPatch, count: int, limited: bool) -> None:
    from configs import dify_config

    monkeypatch.setattr(dify_config, "EMAIL_SEND_IP_LIMIT_PER_MINUTE", 1)
    redis = Mock(spec=RedisClientWrapper)
    redis.get.side_effect = [None, str(count), None]
    redis.set.return_value = True
    gateway = RedisEmailRegistrationSecurityGateway(
        redis=redis,
        login_security=Mock(spec=ConsoleAuthSecurityGateway),
        verification_failure_limit=5,
        verification_lockout_duration=600,
    )

    assert gateway.is_ip_limited("127.0.0.1") is limited
    if limited:
        redis.set.assert_called_once_with("email_send_ip_limit_hour:127.0.0.1", 1, ex=600, nx=True)
    else:
        redis.setex.assert_called_once_with("email_send_ip_limit_minute:127.0.0.1", 60, count + 1)
        redis.expire.assert_called_once_with("email_send_ip_limit_minute:127.0.0.1", 60)


def test_security_gateway_uses_registration_and_login_keys() -> None:
    redis = Mock(spec=RedisClientWrapper)
    redis.get.return_value = 1
    gateway = RedisEmailRegistrationSecurityGateway(
        redis=redis,
        login_security=RedisConsoleAuthSecurityGateway(redis=redis),
        verification_failure_limit=5,
        verification_lockout_duration=600,
    )

    with patch(
        "services.account.login_adapters.RedisConsoleAuthSecurityGateway.reset_login_failures"
    ) as reset_login_error_rate_limit:
        gateway.record_verification_failure("user@example.com")
        gateway.reset_verification_failures("user@example.com")
        gateway.reset_login_failures("user@example.com")

    redis.setex.assert_called_once_with("email_register_error_rate_limit:user@example.com", 600, 2)
    redis.delete.assert_called_once_with("email_register_error_rate_limit:user@example.com")
    reset_login_error_rate_limit.assert_called_once_with("user@example.com")


@pytest.mark.parametrize(("count", "limited"), [(5, False), (6, True)])
def test_registration_verification_limit_preserves_threshold(count: int, limited: bool) -> None:
    redis = Mock(spec=RedisClientWrapper)
    redis.get.return_value = str(count)
    gateway = RedisEmailRegistrationSecurityGateway(
        redis=redis,
        login_security=Mock(spec=ConsoleAuthSecurityGateway),
        verification_failure_limit=5,
        verification_lockout_duration=600,
    )
    assert gateway.is_verification_limited("user@example.com") is limited
    redis.get.assert_called_once_with("email_register_error_rate_limit:user@example.com")


def test_registration_security_preserves_behavior_when_redis_is_unavailable() -> None:
    redis = Mock(spec=RedisClientWrapper)
    redis.get.side_effect = RedisError("offline")
    redis.delete.side_effect = RedisError("offline")
    gateway = RedisEmailRegistrationSecurityGateway(
        redis=redis,
        login_security=RedisConsoleAuthSecurityGateway(redis=redis),
        verification_failure_limit=5,
        verification_lockout_duration=600,
    )
    assert gateway.is_ip_limited("127.0.0.1") is False
    assert gateway.is_verification_limited("user@example.com") is False
    gateway.record_verification_failure("user@example.com")
    gateway.reset_verification_failures("user@example.com")
    gateway.reset_login_failures("user@example.com")


def test_billing_policy_is_disabled_outside_cloud() -> None:
    gateway = BillingAccountRegistrationPolicyGateway(enabled=False)

    with patch("services.account.email_registration_adapters.BillingService.get_email_freeze_type") as freeze_type:
        assert gateway.get_freeze_type("user@example.com") is None

    freeze_type.assert_not_called()


@pytest.mark.parametrize(
    ("service_error", "application_error"),
    [
        pytest.param(SeatsLimitExceededError(), EmailRegistrationSeatsLimitError, id="seat-limit"),
        pytest.param(AccountEmailDomainSuspendedError(), AccountEmailDomainSuspendedError, id="suspended-domain"),
        pytest.param(
            AccountNormalizedEmailAlreadyInUseError(),
            AccountNormalizedEmailAlreadyInUseError,
            id="normalized-email-in-use",
        ),
    ],
)
def test_registration_gateway_preserves_domain_errors_and_translates_seat_limit(
    service_error: Exception,
    application_error: type[Exception],
) -> None:
    gateway = AccountLifecycleRegistrationGateway(accounts=Mock(spec=AccountService))

    with patch.object(gateway._accounts, "create_account_and_tenant", side_effect=service_error):
        with pytest.raises(application_error) as raised:
            gateway.create(
                email="user@example.com",
                password="ValidPass123!",
                interface_language="en-US",
                timezone=None,
                ip_address="127.0.0.1",
            )
    if isinstance(service_error, application_error):
        assert raised.value is service_error
    else:
        assert raised.value.__cause__ is service_error


def test_registration_gateway_uses_account_lifecycle(account_domain: AccountDomain, sqlite_session: Session) -> None:
    gateway = AccountLifecycleRegistrationGateway(accounts=account_domain.accounts)
    account_id = gateway.create(
        email="user@example.com",
        password="ValidPass123!",
        interface_language="en-US",
        timezone=None,
        ip_address="127.0.0.1",
    )
    assert sqlite_session.get(Account, account_id) is not None
    tokens = AccountSessionTokens("access", "refresh", "csrf")
    account_domain.sessions.issue.return_value = tokens
    assert gateway.login(account_id, ip_address="127.0.0.1") == tokens
