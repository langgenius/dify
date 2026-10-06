from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from enums import DeploymentEdition
from extensions.ext_application_services import build_application_services
from extensions.ext_redis import RedisClientWrapper
from machinery.context import RequestContext
from models.account import Account, AccountIntegrate
from services.account_change_email_service import AccountChangeEmailService
from services.account_errors import (
    AccountEmailAlreadyInUseError,
    AccountEmailDomainSuspendedError,
    AccountNotFoundError,
    InvalidChangeEmailCodeError,
    InvalidChangeEmailTokenError,
)
from services.entities.account_entities import (
    AccountChangeEmailNewEmailToken,
    AccountChangeEmailNewEmailVerifiedToken,
    AccountChangeEmailOldEmailToken,
    AccountChangeEmailOldEmailVerifiedToken,
    AccountChangeEmailPhase,
)
from tests.unit_tests.model_factories import make_account


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


def _token_payload(
    token: AccountChangeEmailOldEmailToken
    | AccountChangeEmailOldEmailVerifiedToken
    | AccountChangeEmailNewEmailToken
    | AccountChangeEmailNewEmailVerifiedToken,
) -> dict[str, str]:
    return {
        "account_id": token.account_id,
        "email": token.email,
        "old_email": token.old_email,
        "code": token.code,
        "email_change_phase": token.phase.value,
    }


@pytest.fixture
def service(
    sqlite_session_factory: sessionmaker[Session], redis_transport: tuple[RedisClientWrapper, MagicMock]
) -> AccountChangeEmailService:
    redis, commands = redis_transport
    commands.return_value = 0
    with sqlite_session_factory.begin() as session:
        session.add(make_account(email="old@example.com"))
        session.add(
            AccountIntegrate(account_id="account-1", provider="github", open_id="external-id", encrypted_token="")
        )
    return build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.CLOUD,
        initialization_password="",
        redis=redis,
    ).accounts.change_email


@pytest.fixture
def boundaries(service: AccountChangeEmailService, mocker: MockerFixture) -> dict[str, MagicMock]:
    mocker.patch("services.account.adapters.secrets.randbelow", side_effect=[1, 2, 3, 4, 5, 6])
    mocker.patch("services.account.adapters.send_change_mail_task.delay")
    mocker.patch("services.account.adapters.send_change_mail_completed_notification_task.delay")
    mocker.patch("services.account.adapters.TokenManager.revoke_token")
    return {
        "read_token": mocker.patch("services.account.adapters.TokenManager.get_token_data"),
        "generate_token": mocker.patch("services.account.adapters.TokenManager.generate_token", return_value="token"),
        "freeze_flag": mocker.patch("services.account.adapters.BillingService.is_email_in_freeze", return_value=False),
        "freeze_type": mocker.patch("services.account.adapters.BillingService.get_email_freeze_type"),
        "issue": mocker.spy(service._tokens, "issue"),
        "revoke": mocker.spy(service._tokens, "revoke"),
        "send_code": mocker.spy(service._notifications, "send_code"),
        "send_completed": mocker.spy(service._notifications, "send_completed"),
        "record": mocker.spy(service._send_limits, "record"),
        "reset_email": mocker.spy(service._accounts, "reset_email"),
        "email_exists": mocker.spy(service._accounts, "email_exists"),
        "is_frozen": mocker.spy(service._email_policy, "is_frozen"),
        "reset_verification_failures": mocker.spy(service._security, "reset_verification_failures"),
        "record_verification_failure": mocker.spy(service._security, "record_verification_failure"),
    }


def test_send_old_email_code_coerces_unexpected_phase_to_initial_state(
    service: AccountChangeEmailService,
    boundaries: dict[str, MagicMock],
) -> None:

    token = service.send_code(
        _context(),
        requested_email="OLD@example.com",
        language="en-US",
        phase="unexpected",
        predecessor_token=None,
        ip_address="127.0.0.1",
    )

    assert token == "token"
    issued = boundaries["issue"].call_args.args[0]
    assert issued == AccountChangeEmailOldEmailToken(
        account_id="account-1",
        email="old@example.com",
        old_email="old@example.com",
        code="123456",
    )
    boundaries["send_code"].assert_called_once_with(
        email="old@example.com",
        code="123456",
        language="en-US",
        phase=AccountChangeEmailPhase.OLD_EMAIL,
    )
    boundaries["record"].assert_called_once_with("old@example.com")


def test_send_new_email_code_requires_account_bound_old_verified_token(
    service: AccountChangeEmailService,
    boundaries: dict[str, MagicMock],
) -> None:
    boundaries["read_token"].return_value = _token_payload(
        AccountChangeEmailOldEmailVerifiedToken(
            account_id="account-1",
            email="old@example.com",
            old_email="old@example.com",
            code="old-code",
        )
    )

    service.send_code(
        _context(),
        requested_email="New@Example.com",
        language="zh-Hans",
        phase="new_email",
        predecessor_token="old-verified-token",
        ip_address="127.0.0.1",
    )

    issued = boundaries["issue"].call_args.args[0]
    assert issued == AccountChangeEmailNewEmailToken(
        account_id="account-1",
        email="new@example.com",
        old_email="old@example.com",
        code="123456",
    )


def test_send_new_email_code_rejects_unverified_predecessor(
    service: AccountChangeEmailService,
    boundaries: dict[str, MagicMock],
) -> None:
    boundaries["read_token"].return_value = _token_payload(
        AccountChangeEmailOldEmailToken(
            account_id="account-1",
            email="old@example.com",
            old_email="old@example.com",
            code="old-code",
        )
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

    boundaries["issue"].assert_not_called()


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
    service: AccountChangeEmailService,
    boundaries: dict[str, MagicMock],
    pending: AccountChangeEmailOldEmailToken | AccountChangeEmailNewEmailToken,
    verified_type: type[AccountChangeEmailOldEmailVerifiedToken] | type[AccountChangeEmailNewEmailVerifiedToken],
) -> None:
    boundaries["read_token"].return_value = _token_payload(pending)
    boundaries["generate_token"].return_value = "verified-token"

    result = service.verify_code(
        _context(),
        email=pending.email.upper(),
        code="123456",
        token="pending-token",
    )

    assert result.email == pending.email
    assert result.token == "verified-token"
    assert isinstance(boundaries["issue"].call_args.args[0], verified_type)
    boundaries["revoke"].assert_called_once_with("pending-token")
    boundaries["reset_verification_failures"].assert_called_once_with(pending.email)


def test_verify_code_records_invalid_code_without_promoting_token(
    service: AccountChangeEmailService,
    boundaries: dict[str, MagicMock],
) -> None:
    boundaries["read_token"].return_value = _token_payload(
        AccountChangeEmailNewEmailToken(
            account_id="account-1",
            email="new@example.com",
            old_email="old@example.com",
            code="123456",
        )
    )

    with pytest.raises(InvalidChangeEmailCodeError):
        service.verify_code(
            _context(),
            email="new@example.com",
            code="wrong",
            token="pending-token",
        )

    boundaries["record_verification_failure"].assert_called_once_with("new@example.com")
    boundaries["revoke"].assert_not_called()


def test_reset_updates_account_and_unbinds_integrations_before_external_notifications(
    service: AccountChangeEmailService,
    boundaries: dict[str, MagicMock],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    boundaries["read_token"].return_value = _token_payload(
        AccountChangeEmailNewEmailVerifiedToken(
            account_id="account-1",
            email="new@example.com",
            old_email="old@example.com",
            code="123456",
        )
    )

    result = service.reset(_context(), new_email="New@Example.com", token="verified-token")

    assert result.email == "new@example.com"
    with sqlite_session_factory() as session:
        account = session.get(Account, "account-1")
        assert account is not None
        assert account.email == "new@example.com"
        assert session.scalar(select(AccountIntegrate)) is None
    boundaries["reset_email"].assert_called_once_with(
        "account-1",
        expected_old_email="old@example.com",
        new_email="new@example.com",
    )
    boundaries["revoke"].assert_called_once_with("verified-token")
    boundaries["send_completed"].assert_called_once_with(
        email="new@example.com",
        language="en-US",
    )


def test_email_availability_preserves_suspended_domain_policy(
    service: AccountChangeEmailService,
    boundaries: dict[str, MagicMock],
) -> None:
    boundaries["freeze_flag"].return_value = True
    boundaries["freeze_type"].return_value = "email_domain_suspended"

    with pytest.raises(AccountEmailDomainSuspendedError):
        service.ensure_available("User@Suspended.Example")

    boundaries["is_frozen"].assert_called_once_with("user@suspended.example")
    boundaries["email_exists"].assert_not_called()


def test_reset_rejects_existing_email_without_burning_verified_token(
    service: AccountChangeEmailService,
    boundaries: dict[str, MagicMock],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    boundaries["read_token"].return_value = _token_payload(
        AccountChangeEmailNewEmailVerifiedToken(
            account_id="account-1",
            email="new@example.com",
            old_email="old@example.com",
            code="123456",
        )
    )
    with sqlite_session_factory.begin() as session:
        session.add(make_account(account_id="other-account", email="new@example.com"))

    with pytest.raises(AccountEmailAlreadyInUseError):
        service.reset(_context(), new_email="new@example.com", token="verified-token")

    boundaries["revoke"].assert_not_called()


def test_reset_rejects_token_when_account_email_changed_since_verification(
    service: AccountChangeEmailService,
    boundaries: dict[str, MagicMock],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        account = session.get(Account, "account-1")
        assert account is not None
        account.email = "changed@example.com"
    boundaries["read_token"].return_value = _token_payload(
        AccountChangeEmailNewEmailVerifiedToken(
            account_id="account-1",
            email="new@example.com",
            old_email="old@example.com",
            code="123456",
        )
    )

    with pytest.raises(AccountNotFoundError):
        service.reset(_context(), new_email="new@example.com", token="verified-token")

    boundaries["revoke"].assert_not_called()
