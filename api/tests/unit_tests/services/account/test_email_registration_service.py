from __future__ import annotations

from dataclasses import asdict
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from enums import DeploymentEdition
from extensions.ext_application_services import build_application_services
from extensions.ext_redis import RedisClientWrapper
from models.account import Account
from services.account.email_registration_service import AccountEmailRegistrationService
from services.account_errors import (
    AccountEmailAlreadyInUseError,
    AccountEmailDomainSuspendedError,
    EmailRegistrationPasswordMismatchError,
    InvalidEmailRegistrationCodeError,
    InvalidEmailRegistrationTokenError,
)
from services.entities.account_entities import (
    AccountEmailRegistrationPhase,
    AccountEmailRegistrationToken,
    AccountSessionTokens,
)
from tests.unit_tests.model_factories import make_account


@pytest.fixture
def service(
    sqlite_session_factory: sessionmaker[Session], redis_transport: tuple[RedisClientWrapper, MagicMock]
) -> AccountEmailRegistrationService:
    redis, commands = redis_transport
    commands.return_value = 0
    return build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.CLOUD,
        initialization_password="",
        redis=redis,
    ).accounts.email_registration


@pytest.fixture
def boundaries(service: AccountEmailRegistrationService, mocker: MockerFixture) -> dict[str, MagicMock]:
    mocker.patch("services.account.email_registration_adapters.secrets.randbelow", side_effect=[1, 2, 3, 4, 5, 6])
    mocker.patch("services.account.email_registration_adapters.send_email_register_mail_task.delay")
    mocker.patch("services.account.email_registration_adapters.send_email_register_mail_task_when_account_exist.delay")
    mocker.patch("services.account.email_registration_adapters.TokenManager.revoke_token")
    return {
        "read_token": mocker.patch("services.account.email_registration_adapters.TokenManager.get_token_data"),
        "generate_token": mocker.patch(
            "services.account.email_registration_adapters.TokenManager.generate_token", return_value="token-1"
        ),
        "freeze_type": mocker.patch(
            "services.account.email_registration_adapters.BillingService.get_email_freeze_type", return_value=None
        ),
        "issue": mocker.spy(service._tokens, "issue"),
        "revoke": mocker.spy(service._tokens, "revoke"),
        "find_by_email": mocker.spy(service._accounts, "find_by_email"),
        "send_code": mocker.spy(service._notifications, "send_code"),
        "send_account_exists": mocker.spy(service._notifications, "send_account_exists"),
        "record": mocker.spy(service._send_limits, "record"),
        "reset_verification_failures": mocker.spy(service._security, "reset_verification_failures"),
        "record_verification_failure": mocker.spy(service._security, "record_verification_failure"),
        "reset_login_failures": mocker.spy(service._security, "reset_login_failures"),
        "create": mocker.spy(service._registration, "create"),
        "login": mocker.spy(service._registration, "login"),
    }


def test_send_code_uses_case_fallback_account_and_existing_account_notification(
    service: AccountEmailRegistrationService,
    boundaries: dict[str, MagicMock],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        # Stored casing differs from both the request and its normalized address.
        account = make_account(email="Stored@example.com", name="Stored Account")
        account.normalized_email = "stored@example.com"
        session.add(account)

    token = service.send_code(
        remote_ip="127.0.0.1",
        requested_email="Stored@Example.com",
        requested_language="zh-Hans",
    )

    assert token == "token-1"
    boundaries["find_by_email"].assert_called_once_with("Stored@Example.com")
    boundaries["issue"].assert_called_once_with(
        AccountEmailRegistrationToken(email="Stored@example.com", code="123456")
    )
    boundaries["send_account_exists"].assert_called_once_with(
        email="Stored@example.com",
        account_name="Stored Account",
        language="zh-Hans",
    )
    boundaries["record"].assert_called_once_with("Stored@example.com")


def test_send_code_normalizes_new_account_email_and_language(
    service: AccountEmailRegistrationService,
    boundaries: dict[str, MagicMock],
) -> None:

    service.send_code(
        remote_ip="127.0.0.1",
        requested_email="New@Example.com",
        requested_language="unsupported",
    )

    boundaries["send_code"].assert_called_once_with(
        email="new@example.com",
        code="123456",
        language="en-US",
    )


def test_send_code_rejects_suspended_domain_before_account_lookup(
    service: AccountEmailRegistrationService,
    boundaries: dict[str, MagicMock],
) -> None:
    boundaries["freeze_type"].return_value = "email_domain_suspended"

    with pytest.raises(AccountEmailDomainSuspendedError):
        service.send_code(
            remote_ip="127.0.0.1",
            requested_email="user@suspended.example",
            requested_language=None,
        )

    boundaries["find_by_email"].assert_not_called()


def test_verify_code_rotates_token_into_register_phase(
    service: AccountEmailRegistrationService,
    boundaries: dict[str, MagicMock],
) -> None:
    boundaries["read_token"].return_value = asdict(
        AccountEmailRegistrationToken(
            email="User@Example.com",
            code="123456",
        )
    )
    boundaries["generate_token"].return_value = "verified-token"

    verification = service.verify_code(
        email="USER@example.com",
        code="123456",
        token="pending-token",
    )

    assert verification.email == "user@example.com"
    assert verification.token == "verified-token"
    boundaries["revoke"].assert_called_once_with("pending-token")
    boundaries["issue"].assert_called_once_with(
        AccountEmailRegistrationToken(
            email="user@example.com",
            code="123456",
            phase=AccountEmailRegistrationPhase.REGISTER,
        )
    )
    boundaries["reset_verification_failures"].assert_called_once_with("user@example.com")


def test_verify_code_records_failure_without_consuming_token(
    service: AccountEmailRegistrationService,
    boundaries: dict[str, MagicMock],
) -> None:
    boundaries["read_token"].return_value = asdict(
        AccountEmailRegistrationToken(
            email="user@example.com",
            code="123456",
        )
    )

    with pytest.raises(InvalidEmailRegistrationCodeError):
        service.verify_code(email="user@example.com", code="wrong", token="pending-token")

    boundaries["record_verification_failure"].assert_called_once_with("user@example.com")
    boundaries["revoke"].assert_not_called()


def test_register_creates_account_and_logs_it_in(
    service: AccountEmailRegistrationService,
    boundaries: dict[str, MagicMock],
    sqlite_session_factory: sessionmaker[Session],
    mocker: MockerFixture,
) -> None:
    boundaries["read_token"].return_value = asdict(
        AccountEmailRegistrationToken(
            email="New@Example.com",
            code="123456",
            phase=AccountEmailRegistrationPhase.REGISTER,
        )
    )
    expected_tokens = AccountSessionTokens(access_token="access", refresh_token="refresh", csrf_token="csrf")

    def provision_account(
        *,
        email: str,
        name: str,
        password: str,
        interface_language: str,
        timezone: str,
        ip_address: str,
        check_normalized_email: bool,
    ) -> Account:
        assert password == "ValidPass123!"
        assert ip_address == "127.0.0.1"
        assert check_normalized_email is True
        account = make_account(email=email, name=name, interface_language=interface_language, timezone=timezone)
        with sqlite_session_factory.begin() as session:
            session.add(account)
        return account

    mocker.patch(
        "services.account.email_registration_adapters.AccountService.create_account_and_tenant",
        side_effect=provision_account,
    )
    login = mocker.patch(
        "services.account.email_registration_adapters.AccountService.login",
        return_value=expected_tokens,
    )

    tokens = service.register(
        remote_ip="127.0.0.1",
        token="verified-token",
        new_password="ValidPass123!",
        password_confirm="ValidPass123!",
        language="zh-Hans",
        timezone="Asia/Shanghai",
    )

    assert tokens == expected_tokens
    with sqlite_session_factory() as session:
        account = session.get(Account, "account-1")
        assert account is not None
        assert (account.email, account.interface_language, account.timezone) == (
            "new@example.com",
            "zh-Hans",
            "Asia/Shanghai",
        )
    login.assert_called_once_with("account-1", ip_address="127.0.0.1")
    boundaries["revoke"].assert_called_once_with("verified-token")
    boundaries["find_by_email"].assert_called_once_with("New@Example.com")
    boundaries["create"].assert_called_once_with(
        email="new@example.com",
        password="ValidPass123!",
        interface_language="zh-Hans",
        timezone="Asia/Shanghai",
        ip_address="127.0.0.1",
    )
    boundaries["login"].assert_called_once_with("account-1", ip_address="127.0.0.1")
    boundaries["reset_login_failures"].assert_called_once_with("new@example.com")


def test_register_rejects_password_mismatch_before_reading_token(
    service: AccountEmailRegistrationService,
    boundaries: dict[str, MagicMock],
) -> None:

    with pytest.raises(EmailRegistrationPasswordMismatchError):
        service.register(
            remote_ip="127.0.0.1",
            token="verified-token",
            new_password="ValidPass123!",
            password_confirm="DifferentPass123!",
            language=None,
            timezone=None,
        )

    boundaries["read_token"].assert_not_called()


def test_register_requires_verified_registration_phase(
    service: AccountEmailRegistrationService,
    boundaries: dict[str, MagicMock],
) -> None:
    boundaries["read_token"].return_value = asdict(
        AccountEmailRegistrationToken(
            email="new@example.com",
            code="123456",
        )
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

    boundaries["revoke"].assert_not_called()


def test_register_consumes_token_before_rejecting_existing_account(
    service: AccountEmailRegistrationService,
    boundaries: dict[str, MagicMock],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    boundaries["read_token"].return_value = asdict(
        AccountEmailRegistrationToken(
            email="existing@example.com",
            code="123456",
            phase=AccountEmailRegistrationPhase.REGISTER,
        )
    )
    with sqlite_session_factory.begin() as session:
        session.add(make_account(email="existing@example.com", name="Stored Account"))

    with pytest.raises(AccountEmailAlreadyInUseError):
        service.register(
            remote_ip="127.0.0.1",
            token="verified-token",
            new_password="ValidPass123!",
            password_confirm="ValidPass123!",
            language=None,
            timezone=None,
        )

    boundaries["revoke"].assert_called_once_with("verified-token")
    boundaries["create"].assert_not_called()
