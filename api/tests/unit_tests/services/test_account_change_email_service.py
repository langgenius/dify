from __future__ import annotations

from datetime import datetime
from unittest.mock import Mock

import pytest

from machinery.context import RequestContext
from services.account_change_email_ports import (
    AccountEmailPolicyGateway,
    ChangeEmailCodeGenerator,
    ChangeEmailNotificationGateway,
    ChangeEmailSecurityGateway,
    ChangeEmailSendLimiter,
    ChangeEmailTokenGateway,
)
from services.account_change_email_service import AccountChangeEmailService
from services.account_errors import (
    AccountEmailAlreadyInUseError,
    AccountEmailDomainSuspendedError,
    AccountNotFoundError,
    InvalidChangeEmailCodeError,
    InvalidChangeEmailTokenError,
)
from services.account_ports import AccountRepository
from services.entities.account_entities import (
    AccountChangeEmailNewEmailToken,
    AccountChangeEmailNewEmailVerifiedToken,
    AccountChangeEmailOldEmailToken,
    AccountChangeEmailOldEmailVerifiedToken,
    AccountChangeEmailPhase,
    AccountEmailResetResult,
    AccountEmailResetStatus,
    AccountSnapshot,
)


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


def _account(*, email: str = "old@example.com") -> AccountSnapshot:
    return AccountSnapshot(
        id="account-1",
        name="Account",
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


def _service() -> tuple[AccountChangeEmailService, dict[str, Mock]]:
    dependencies = {
        "accounts": Mock(spec=AccountRepository),
        "tokens": Mock(spec=ChangeEmailTokenGateway),
        "codes": Mock(spec=ChangeEmailCodeGenerator),
        "notifications": Mock(spec=ChangeEmailNotificationGateway),
        "send_limits": Mock(spec=ChangeEmailSendLimiter),
        "security": Mock(spec=ChangeEmailSecurityGateway),
        "email_policy": Mock(spec=AccountEmailPolicyGateway),
    }
    service = AccountChangeEmailService(
        accounts=dependencies["accounts"],
        tokens=dependencies["tokens"],
        codes=dependencies["codes"],
        notifications=dependencies["notifications"],
        send_limits=dependencies["send_limits"],
        security=dependencies["security"],
        email_policy=dependencies["email_policy"],
    )
    dependencies["accounts"].get.return_value = _account()
    dependencies["codes"].generate.return_value = "123456"
    dependencies["tokens"].issue.return_value = "token"
    dependencies["send_limits"].is_limited.return_value = False
    dependencies["security"].is_ip_limited.return_value = False
    dependencies["security"].is_verification_limited.return_value = False
    dependencies["email_policy"].is_frozen.return_value = False
    return service, dependencies


def test_send_old_email_code_coerces_unexpected_phase_to_initial_state() -> None:
    service, dependencies = _service()

    token = service.send_code(
        _context(),
        requested_email="OLD@example.com",
        language="en-US",
        phase="unexpected",
        predecessor_token=None,
        ip_address="127.0.0.1",
    )

    assert token == "token"
    issued = dependencies["tokens"].issue.call_args.args[0]
    assert issued == AccountChangeEmailOldEmailToken(
        account_id="account-1",
        email="old@example.com",
        old_email="old@example.com",
        code="123456",
    )
    dependencies["notifications"].send_code.assert_called_once_with(
        email="old@example.com",
        code="123456",
        language="en-US",
        phase=AccountChangeEmailPhase.OLD_EMAIL,
    )
    dependencies["send_limits"].record.assert_called_once_with("old@example.com")


def test_send_new_email_code_requires_account_bound_old_verified_token() -> None:
    service, dependencies = _service()
    dependencies["tokens"].get.return_value = AccountChangeEmailOldEmailVerifiedToken(
        account_id="account-1",
        email="old@example.com",
        old_email="old@example.com",
        code="old-code",
    )

    service.send_code(
        _context(),
        requested_email="New@Example.com",
        language="zh-Hans",
        phase="new_email",
        predecessor_token="old-verified-token",
        ip_address="127.0.0.1",
    )

    issued = dependencies["tokens"].issue.call_args.args[0]
    assert issued == AccountChangeEmailNewEmailToken(
        account_id="account-1",
        email="new@example.com",
        old_email="old@example.com",
        code="123456",
    )


def test_send_new_email_code_rejects_unverified_predecessor() -> None:
    service, dependencies = _service()
    dependencies["tokens"].get.return_value = AccountChangeEmailOldEmailToken(
        account_id="account-1",
        email="old@example.com",
        old_email="old@example.com",
        code="old-code",
    )

    with pytest.raises(InvalidChangeEmailTokenError):
        service.send_code(
            _context(),
            requested_email="new@example.com",
            language="en-US",
            phase="new_email",
            predecessor_token="unverified-token",
            ip_address="127.0.0.1",
        )

    dependencies["tokens"].issue.assert_not_called()


@pytest.mark.parametrize(
    ("pending", "verified_type"),
    [
        (
            AccountChangeEmailOldEmailToken(
                account_id="account-1",
                email="old@example.com",
                old_email="old@example.com",
                code="123456",
            ),
            AccountChangeEmailOldEmailVerifiedToken,
        ),
        (
            AccountChangeEmailNewEmailToken(
                account_id="account-1",
                email="new@example.com",
                old_email="old@example.com",
                code="123456",
            ),
            AccountChangeEmailNewEmailVerifiedToken,
        ),
    ],
)
def test_verify_code_promotes_only_pending_account_bound_token(
    pending: AccountChangeEmailOldEmailToken | AccountChangeEmailNewEmailToken,
    verified_type: type[AccountChangeEmailOldEmailVerifiedToken] | type[AccountChangeEmailNewEmailVerifiedToken],
) -> None:
    service, dependencies = _service()
    dependencies["tokens"].get.return_value = pending
    dependencies["tokens"].issue.return_value = "verified-token"

    result = service.verify_code(
        _context(),
        email=pending.email.upper(),
        code="123456",
        token="pending-token",
    )

    assert result.email == pending.email
    assert result.token == "verified-token"
    assert isinstance(dependencies["tokens"].issue.call_args.args[0], verified_type)
    dependencies["tokens"].revoke.assert_called_once_with("pending-token")
    dependencies["security"].reset_verification_failures.assert_called_once_with(pending.email)


def test_verify_code_records_invalid_code_without_promoting_token() -> None:
    service, dependencies = _service()
    dependencies["tokens"].get.return_value = AccountChangeEmailNewEmailToken(
        account_id="account-1",
        email="new@example.com",
        old_email="old@example.com",
        code="123456",
    )

    with pytest.raises(InvalidChangeEmailCodeError):
        service.verify_code(
            _context(),
            email="new@example.com",
            code="wrong",
            token="pending-token",
        )

    dependencies["security"].record_verification_failure.assert_called_once_with("new@example.com")
    dependencies["tokens"].revoke.assert_not_called()


def test_reset_updates_account_and_unbinds_integrations_before_external_notifications() -> None:
    service, dependencies = _service()
    dependencies["tokens"].get.return_value = AccountChangeEmailNewEmailVerifiedToken(
        account_id="account-1",
        email="new@example.com",
        old_email="old@example.com",
        code="123456",
    )
    dependencies["accounts"].reset_email.return_value = AccountEmailResetResult(
        status=AccountEmailResetStatus.UPDATED,
        account=_account(email="new@example.com"),
    )

    result = service.reset(_context(), new_email="New@Example.com", token="verified-token")

    assert result.email == "new@example.com"
    dependencies["accounts"].reset_email.assert_called_once_with(
        "account-1",
        expected_old_email="old@example.com",
        new_email="new@example.com",
    )
    dependencies["tokens"].revoke.assert_called_once_with("verified-token")
    dependencies["notifications"].send_completed.assert_called_once_with(
        email="new@example.com",
        language="en-US",
    )


def test_email_availability_preserves_suspended_domain_policy() -> None:
    service, dependencies = _service()
    dependencies["email_policy"].is_frozen.return_value = "email_domain_suspended"

    with pytest.raises(AccountEmailDomainSuspendedError):
        service.ensure_available("User@Suspended.Example")

    dependencies["email_policy"].is_frozen.assert_called_once_with("user@suspended.example")
    dependencies["accounts"].email_exists.assert_not_called()


def test_reset_rejects_existing_email_without_burning_verified_token() -> None:
    service, dependencies = _service()
    dependencies["tokens"].get.return_value = AccountChangeEmailNewEmailVerifiedToken(
        account_id="account-1",
        email="new@example.com",
        old_email="old@example.com",
        code="123456",
    )
    dependencies["accounts"].reset_email.return_value = AccountEmailResetResult(
        status=AccountEmailResetStatus.EMAIL_IN_USE
    )

    with pytest.raises(AccountEmailAlreadyInUseError):
        service.reset(_context(), new_email="new@example.com", token="verified-token")

    dependencies["tokens"].revoke.assert_not_called()


def test_reset_rejects_token_when_account_email_changed_since_verification() -> None:
    service, dependencies = _service()
    dependencies["accounts"].reset_email.return_value = AccountEmailResetResult(
        status=AccountEmailResetStatus.EMAIL_CHANGED
    )
    dependencies["tokens"].get.return_value = AccountChangeEmailNewEmailVerifiedToken(
        account_id="account-1",
        email="new@example.com",
        old_email="old@example.com",
        code="123456",
    )

    with pytest.raises(AccountNotFoundError):
        service.reset(_context(), new_email="new@example.com", token="verified-token")

    dependencies["tokens"].revoke.assert_not_called()
