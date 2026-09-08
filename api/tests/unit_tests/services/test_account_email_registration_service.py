from __future__ import annotations

from datetime import datetime
from unittest.mock import Mock

import pytest

from services.account_email_registration_service import (
    AccountEmailRegistrationService,
    AccountRegistrationGateway,
    AccountRegistrationPolicyGateway,
    EmailRegistrationCodeGenerator,
    EmailRegistrationNotificationGateway,
    EmailRegistrationSecurityGateway,
    EmailRegistrationSendLimiter,
    EmailRegistrationTokenGateway,
)
from services.account_errors import (
    AccountEmailAlreadyInUseError,
    AccountEmailDomainSuspendedError,
    EmailRegistrationPasswordMismatchError,
    InvalidEmailRegistrationCodeError,
    InvalidEmailRegistrationTokenError,
)
from services.account_ports import AccountRepository
from services.entities.account_entities import (
    AccountEmailRegistrationPhase,
    AccountEmailRegistrationToken,
    AccountSessionTokens,
    AccountSnapshot,
)


def _account(*, email: str = "stored@example.com") -> AccountSnapshot:
    return AccountSnapshot(
        id="account-1",
        name="Stored Account",
        email=email,
        avatar=None,
        is_password_set=True,
        interface_language="en-US",
        interface_theme="light",
        timezone="UTC",
        last_login_at=None,
        last_login_ip=None,
        status="active",
        initialized_at=datetime(2026, 1, 1),
        created_at=datetime(2026, 1, 1),
    )


def _service() -> tuple[AccountEmailRegistrationService, dict[str, Mock]]:
    dependencies = {
        "accounts": Mock(spec=AccountRepository),
        "tokens": Mock(spec=EmailRegistrationTokenGateway),
        "codes": Mock(spec=EmailRegistrationCodeGenerator),
        "notifications": Mock(spec=EmailRegistrationNotificationGateway),
        "send_limits": Mock(spec=EmailRegistrationSendLimiter),
        "security": Mock(spec=EmailRegistrationSecurityGateway),
        "account_policy": Mock(spec=AccountRegistrationPolicyGateway),
        "registration": Mock(spec=AccountRegistrationGateway),
    }
    service = AccountEmailRegistrationService(
        accounts=dependencies["accounts"],
        tokens=dependencies["tokens"],
        codes=dependencies["codes"],
        notifications=dependencies["notifications"],
        send_limits=dependencies["send_limits"],
        security=dependencies["security"],
        account_policy=dependencies["account_policy"],
        registration=dependencies["registration"],
    )
    dependencies["accounts"].find_by_email.return_value = None
    dependencies["codes"].generate.return_value = "123456"
    dependencies["tokens"].issue.return_value = "token-1"
    dependencies["send_limits"].is_limited.return_value = False
    dependencies["security"].is_ip_limited.return_value = False
    dependencies["security"].is_verification_limited.return_value = False
    dependencies["account_policy"].get_freeze_type.return_value = None
    return service, dependencies


def test_send_code_uses_case_fallback_account_and_existing_account_notification() -> None:
    service, dependencies = _service()
    dependencies["accounts"].find_by_email.return_value = _account(email="Stored@Example.com")

    token = service.send_code(
        remote_ip="127.0.0.1",
        requested_email="Stored@Example.com",
        requested_language="zh-Hans",
    )

    assert token == "token-1"
    dependencies["accounts"].find_by_email.assert_called_once_with("Stored@Example.com")
    dependencies["tokens"].issue.assert_called_once_with(
        AccountEmailRegistrationToken(email="Stored@Example.com", code="123456")
    )
    dependencies["notifications"].send_account_exists.assert_called_once_with(
        email="Stored@Example.com",
        account_name="Stored Account",
        language="zh-Hans",
    )
    dependencies["send_limits"].record.assert_called_once_with("Stored@Example.com")


def test_send_code_normalizes_new_account_email_and_language() -> None:
    service, dependencies = _service()

    service.send_code(
        remote_ip="127.0.0.1",
        requested_email="New@Example.com",
        requested_language="unsupported",
    )

    dependencies["notifications"].send_code.assert_called_once_with(
        email="new@example.com",
        code="123456",
        language="en-US",
    )


def test_send_code_rejects_suspended_domain_before_account_lookup() -> None:
    service, dependencies = _service()
    dependencies["account_policy"].get_freeze_type.return_value = "email_domain_suspended"

    with pytest.raises(AccountEmailDomainSuspendedError):
        service.send_code(
            remote_ip="127.0.0.1",
            requested_email="user@suspended.example",
            requested_language=None,
        )

    dependencies["accounts"].find_by_email.assert_not_called()


def test_verify_code_rotates_token_into_register_phase() -> None:
    service, dependencies = _service()
    dependencies["tokens"].get.return_value = AccountEmailRegistrationToken(
        email="User@Example.com",
        code="123456",
    )
    dependencies["tokens"].issue.return_value = "verified-token"

    verification = service.verify_code(
        email="USER@example.com",
        code="123456",
        token="pending-token",
    )

    assert verification.email == "user@example.com"
    assert verification.token == "verified-token"
    dependencies["tokens"].revoke.assert_called_once_with("pending-token")
    dependencies["tokens"].issue.assert_called_once_with(
        AccountEmailRegistrationToken(
            email="user@example.com",
            code="123456",
            phase=AccountEmailRegistrationPhase.REGISTER,
        )
    )
    dependencies["security"].reset_verification_failures.assert_called_once_with("user@example.com")


def test_verify_code_records_failure_without_consuming_token() -> None:
    service, dependencies = _service()
    dependencies["tokens"].get.return_value = AccountEmailRegistrationToken(
        email="user@example.com",
        code="123456",
    )

    with pytest.raises(InvalidEmailRegistrationCodeError):
        service.verify_code(email="user@example.com", code="wrong", token="pending-token")

    dependencies["security"].record_verification_failure.assert_called_once_with("user@example.com")
    dependencies["tokens"].revoke.assert_not_called()


def test_register_creates_account_and_logs_it_in() -> None:
    service, dependencies = _service()
    dependencies["tokens"].get.return_value = AccountEmailRegistrationToken(
        email="New@Example.com",
        code="123456",
        phase=AccountEmailRegistrationPhase.REGISTER,
    )
    dependencies["registration"].create.return_value = "account-1"
    expected_tokens = AccountSessionTokens(access_token="access", refresh_token="refresh", csrf_token="csrf")
    dependencies["registration"].login.return_value = expected_tokens

    tokens = service.register(
        remote_ip="127.0.0.1",
        token="verified-token",
        new_password="ValidPass123!",
        password_confirm="ValidPass123!",
        language="zh-Hans",
        timezone="Asia/Shanghai",
    )

    assert tokens == expected_tokens
    dependencies["tokens"].revoke.assert_called_once_with("verified-token")
    dependencies["accounts"].find_by_email.assert_called_once_with("New@Example.com")
    dependencies["registration"].create.assert_called_once_with(
        email="new@example.com",
        password="ValidPass123!",
        interface_language="zh-Hans",
        timezone="Asia/Shanghai",
        ip_address="127.0.0.1",
    )
    dependencies["registration"].login.assert_called_once_with("account-1", ip_address="127.0.0.1")
    dependencies["security"].reset_login_failures.assert_called_once_with("new@example.com")


def test_register_rejects_password_mismatch_before_reading_token() -> None:
    service, dependencies = _service()

    with pytest.raises(EmailRegistrationPasswordMismatchError):
        service.register(
            remote_ip="127.0.0.1",
            token="verified-token",
            new_password="ValidPass123!",
            password_confirm="DifferentPass123!",
            language=None,
            timezone=None,
        )

    dependencies["tokens"].get.assert_not_called()


def test_register_requires_verified_registration_phase() -> None:
    service, dependencies = _service()
    dependencies["tokens"].get.return_value = AccountEmailRegistrationToken(
        email="new@example.com",
        code="123456",
    )

    with pytest.raises(InvalidEmailRegistrationTokenError):
        service.register(
            remote_ip="127.0.0.1",
            token="pending-token",
            new_password="ValidPass123!",
            password_confirm="ValidPass123!",
            language=None,
            timezone=None,
        )

    dependencies["tokens"].revoke.assert_not_called()


def test_register_consumes_token_before_rejecting_existing_account() -> None:
    service, dependencies = _service()
    dependencies["tokens"].get.return_value = AccountEmailRegistrationToken(
        email="existing@example.com",
        code="123456",
        phase=AccountEmailRegistrationPhase.REGISTER,
    )
    dependencies["accounts"].find_by_email.return_value = _account(email="existing@example.com")

    with pytest.raises(AccountEmailAlreadyInUseError):
        service.register(
            remote_ip="127.0.0.1",
            token="verified-token",
            new_password="ValidPass123!",
            password_confirm="ValidPass123!",
            language=None,
            timezone=None,
        )

    dependencies["tokens"].revoke.assert_called_once_with("verified-token")
    dependencies["registration"].create.assert_not_called()
