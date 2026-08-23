from unittest.mock import Mock, patch

import pytest
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_redis import RedisClientWrapper
from models.account import Account
from services.account_email_registration_adapters import (
    AccountServiceRegistrationGateway,
    BillingAccountRegistrationPolicyGateway,
    RedisEmailRegistrationSecurityGateway,
    TokenManagerEmailRegistrationTokenGateway,
)
from services.account_errors import AccountEmailDomainSuspendedError, EmailRegistrationSeatsLimitError
from services.account_service import TokenPair
from services.entities.account_entities import AccountEmailRegistrationPhase, AccountEmailRegistrationToken
from services.errors.account import EmailDomainSuspendedError, SeatsLimitExceededError


def test_token_gateway_rejects_malformed_payload() -> None:
    gateway = TokenManagerEmailRegistrationTokenGateway()

    with patch(
        "services.account_email_registration_adapters.TokenManager.get_token_data",
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
        "services.account_email_registration_adapters.TokenManager.generate_token",
        return_value="token",
    ) as generate_token:
        assert gateway.issue(token_data) == "token"

    generate_token.assert_called_once_with(
        email="user@example.com",
        token_type="email_register",
        additional_data={"code": "123456", "phase": "register"},
    )


def test_security_gateway_delegates_ip_limit_to_existing_policy_owner() -> None:
    redis = Mock(spec=RedisClientWrapper)
    gateway = RedisEmailRegistrationSecurityGateway(
        redis=redis,
        verification_failure_limit=5,
        verification_lockout_duration=600,
    )

    with patch(
        "services.account_email_registration_adapters.AccountService.is_email_send_ip_limit",
        return_value=False,
    ) as is_email_send_ip_limit:
        assert gateway.is_ip_limited("127.0.0.1") is False

    is_email_send_ip_limit.assert_called_once_with("127.0.0.1")
    redis.get.assert_not_called()


def test_security_gateway_uses_registration_and_login_keys() -> None:
    redis = Mock(spec=RedisClientWrapper)
    redis.get.return_value = 1
    gateway = RedisEmailRegistrationSecurityGateway(
        redis=redis,
        verification_failure_limit=5,
        verification_lockout_duration=600,
    )

    with patch(
        "services.account_email_registration_adapters.AccountService.reset_login_error_rate_limit"
    ) as reset_login_error_rate_limit:
        gateway.record_verification_failure("user@example.com")
        gateway.reset_verification_failures("user@example.com")
        gateway.reset_login_failures("user@example.com")

    redis.setex.assert_called_once_with("email_register_error_rate_limit:user@example.com", 600, 2)
    redis.delete.assert_called_once_with("email_register_error_rate_limit:user@example.com")
    reset_login_error_rate_limit.assert_called_once_with("user@example.com")


def test_billing_policy_is_disabled_outside_cloud() -> None:
    gateway = BillingAccountRegistrationPolicyGateway(enabled=False)

    with patch("services.account_email_registration_adapters.BillingService.get_email_freeze_type") as freeze_type:
        assert gateway.get_freeze_type("user@example.com") is None

    freeze_type.assert_not_called()


@pytest.mark.parametrize(
    ("service_error", "application_error"),
    [
        pytest.param(SeatsLimitExceededError(), EmailRegistrationSeatsLimitError, id="seat-limit"),
        pytest.param(EmailDomainSuspendedError(), AccountEmailDomainSuspendedError, id="suspended-domain"),
    ],
)
def test_registration_gateway_translates_account_provisioning_errors(
    sqlite_session_factory: sessionmaker[Session],
    service_error: Exception,
    application_error: type[Exception],
) -> None:
    gateway = AccountServiceRegistrationGateway(session_factory=sqlite_session_factory)

    with patch(
        "services.account_email_registration_adapters.AccountService.create_account_and_tenant",
        side_effect=service_error,
    ):
        with pytest.raises(application_error):
            gateway.create(
                email="user@example.com",
                password="ValidPass123!",
                interface_language="en-US",
                timezone=None,
                ip_address="127.0.0.1",
            )


def test_registration_gateway_owns_short_lived_sessions(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    gateway = AccountServiceRegistrationGateway(session_factory=sqlite_session_factory)

    def create_account(*, session: Session, **_: object) -> Account:
        account = Account(name="user@example.com", email="user@example.com")
        account.id = "account-1"
        session.add(account)
        session.commit()
        return account

    with patch(
        "services.account_email_registration_adapters.AccountService.create_account_and_tenant",
        side_effect=create_account,
    ):
        account_id = gateway.create(
            email="user@example.com",
            password="ValidPass123!",
            interface_language="en-US",
            timezone=None,
            ip_address="127.0.0.1",
        )

    sqlite_session.expire_all()
    assert sqlite_session.get(Account, account_id) is not None

    with patch(
        "services.account_email_registration_adapters.AccountService.login",
        return_value=TokenPair(access_token="access", refresh_token="refresh", csrf_token="csrf"),
    ) as login:
        tokens = gateway.login(account_id, ip_address="127.0.0.1")

    assert tokens.access_token == "access"
    assert login.call_args.kwargs["account"].id == account_id
    assert isinstance(login.call_args.kwargs["session"], Session)
