from collections.abc import Callable
from unittest.mock import MagicMock, call, create_autospec, patch

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
def test_security_gateway_preserves_shared_ip_limit(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    config_overrides: Callable[..., None],
    count: int,
    limited: bool,
) -> None:
    config_overrides(EMAIL_SEND_IP_LIMIT_PER_MINUTE=1)
    redis, commands = redis_transport
    commands.side_effect = [None, str(count), None, True] if limited else [None, str(count), True, True]
    gateway = RedisEmailRegistrationSecurityGateway(
        redis=redis,
        login_security=create_autospec(ConsoleAuthSecurityGateway, instance=True),
        verification_failure_limit=5,
        verification_lockout_duration=600,
    )

    assert gateway.is_ip_limited("127.0.0.1") is limited
    freeze_key = "email_send_ip_limit_freeze:127.0.0.1"
    minute_key = "email_send_ip_limit_minute:127.0.0.1"
    hour_key = "email_send_ip_limit_hour:127.0.0.1"
    if limited:
        assert commands.call_args_list == [
            call("GET", freeze_key, keys=[freeze_key]),
            call("GET", minute_key, keys=[minute_key]),
            call("GET", hour_key, keys=[hour_key]),
            call("SET", hour_key, 1, "NX", "EX", 600),
        ]
    else:
        assert commands.call_args_list == [
            call("GET", freeze_key, keys=[freeze_key]),
            call("GET", minute_key, keys=[minute_key]),
            call("SETEX", minute_key, 60, count + 1),
            call("EXPIRE", minute_key, 60),
        ]


def test_security_gateway_uses_registration_and_login_keys(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    redis, commands = redis_transport
    commands.return_value = 1
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

    key = "email_register_error_rate_limit:user@example.com"
    assert commands.call_args_list == [
        call("GET", key, keys=[key]),
        call("SETEX", key, 600, 2),
        call("DEL", key),
    ]
    reset_login_error_rate_limit.assert_called_once_with("user@example.com")


@pytest.mark.parametrize(("count", "limited"), [(5, False), (6, True)])
def test_registration_verification_limit_preserves_threshold(count: int, limited: bool) -> None:
    redis = create_autospec(RedisClientWrapper, instance=True)
    redis.get.return_value = str(count)
    gateway = RedisEmailRegistrationSecurityGateway(
        redis=redis,
        login_security=create_autospec(ConsoleAuthSecurityGateway, instance=True),
        verification_failure_limit=5,
        verification_lockout_duration=600,
    )
    assert gateway.is_verification_limited("user@example.com") is limited
    redis.get.assert_called_once_with("email_register_error_rate_limit:user@example.com")


def test_registration_security_preserves_behavior_when_redis_is_unavailable() -> None:
    redis = create_autospec(RedisClientWrapper, instance=True)
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
    gateway = AccountLifecycleRegistrationGateway(accounts=create_autospec(AccountService, instance=True))

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
