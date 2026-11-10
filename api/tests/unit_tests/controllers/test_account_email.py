"""Exercise shared email-change transport with real application behavior and persistence."""

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session, sessionmaker

from controllers.account_email import (
    check_change_email_available,
    reset_change_email,
    send_change_email_code,
    verify_change_email_code,
)
from controllers.account_email_errors import (
    AccountInFreezeError,
    EmailAlreadyInUseError,
    EmailChangeLimitError,
    EmailChangeRateLimitExceededError,
    EmailCodeError,
    EmailDomainSuspendedError,
    EmailSendIpLimitError,
    InvalidEmailError,
    InvalidTokenError,
)
from controllers.common.account import ChangeEmailSendPayload
from machinery.context import AccountRequestContext, RequestContext
from models.account import Account
from repositories.account.repository import SQLAlchemyAccountRepository
from services.account.adapters import SecureChangeEmailCodeGenerator
from services.account_change_email_service import AccountChangeEmailService
from services.account_errors import AccountNotFoundError
from services.entities.account_entities import AccountChangeEmailNewEmailVerifiedToken, AccountChangeEmailOldEmailToken
from tests.helpers.unit.account_email import AccountEmailTransports
from tests.helpers.unit.model_factories import make_account


@pytest.fixture(params=["account", "workspace"])
def context(request: pytest.FixtureRequest) -> AccountRequestContext | RequestContext:
    if request.param == "account":
        return AccountRequestContext(request_id="request", trace_id=None, account_id="account-1")
    return RequestContext(
        request_id="request", trace_id=None, account_id="account-1", active_workspace_id="workspace-1"
    )


@pytest.fixture
def transports() -> AccountEmailTransports:
    return AccountEmailTransports()


@pytest.fixture
def service(
    sqlite_session_factory: sessionmaker[Session], transports: AccountEmailTransports
) -> AccountChangeEmailService:
    with sqlite_session_factory.begin() as session:
        session.add(make_account(account_id="account-1"))
        session.add(make_account(account_id="account-2", email="other@example.com"))
    return AccountChangeEmailService(
        accounts=SQLAlchemyAccountRepository(sqlite_session_factory),
        tokens=transports,
        codes=SecureChangeEmailCodeGenerator(),
        notifications=transports,
        send_limits=transports,
        security=transports,
        email_policy=transports,
    )


@pytest.mark.parametrize("language", ["zh-Hans", "unsupported"])
def test_shared_flow_accepts_raw_and_validated_payloads(
    service: AccountChangeEmailService,
    context: AccountRequestContext | RequestContext,
    transports: AccountEmailTransports,
    language: str,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    challenge = send_change_email_code(
        service,
        context,
        ChangeEmailSendPayload(email="test@example.com", language=language),
        ip_address="127.0.0.1",
    )
    assert transports.sent[-1][2] == ("zh-Hans" if language == "zh-Hans" else "en-US")
    verified_old = verify_change_email_code(
        service, context, {"email": "test@example.com", "code": transports.sent[-1][1], "token": challenge.data}
    )
    assert check_change_email_available(service, {"email": "new@example.com"}).model_dump() == {"result": "success"}
    challenge = send_change_email_code(
        service,
        context,
        {"email": "new@example.com", "phase": "new_email", "token": verified_old.token},
        ip_address="127.0.0.1",
    )
    verified_new = verify_change_email_code(
        service, context, {"email": "new@example.com", "code": transports.sent[-1][1], "token": challenge.data}
    )
    assert verified_new.is_valid is True
    updated = reset_change_email(service, context, {"new_email": "new@example.com", "token": verified_new.token})
    assert updated.email == "new@example.com"
    assert transports.completed == ["new@example.com"]
    assert verified_new.token not in transports.tokens
    with sqlite_session_factory() as session:
        assert session.get_one(Account, "account-1").email == "new@example.com"
        assert session.get_one(Account, "account-2").email == "other@example.com"


def test_shared_payload_validation_precedes_service_effects(
    service: AccountChangeEmailService,
    context: AccountRequestContext | RequestContext,
    transports: AccountEmailTransports,
) -> None:
    with pytest.raises(ValidationError):
        send_change_email_code(service, context, {}, ip_address="127.0.0.1")
    with pytest.raises(ValidationError):
        verify_change_email_code(service, context, {})
    with pytest.raises(ValidationError):
        reset_change_email(service, context, {})
    with pytest.raises(ValidationError):
        check_change_email_available(service, {})
    assert transports.sent == []
    assert transports.tokens == {}
    assert transports.completed == []


def test_shared_send_error_mapping(
    service: AccountChangeEmailService,
    context: AccountRequestContext | RequestContext,
    transports: AccountEmailTransports,
) -> None:
    with pytest.raises(InvalidEmailError):
        send_change_email_code(service, context, {"email": "other@example.com"}, ip_address="127.0.0.1")
    with pytest.raises(InvalidTokenError):
        send_change_email_code(
            service, context, {"email": "new@example.com", "phase": "new_email"}, ip_address="127.0.0.1"
        )
    transports.sends["test@example.com"] = 3
    with pytest.raises(EmailChangeRateLimitExceededError):
        send_change_email_code(service, context, {"email": "test@example.com"}, ip_address="127.0.0.1")
    transports.ip_limited = True
    with pytest.raises(EmailSendIpLimitError):
        send_change_email_code(service, context, {"email": "test@example.com"}, ip_address="127.0.0.1")
    assert transports.sent == []


def test_shared_verification_error_mapping(
    service: AccountChangeEmailService,
    context: AccountRequestContext | RequestContext,
    transports: AccountEmailTransports,
) -> None:
    token = transports.issue(
        AccountChangeEmailOldEmailToken(
            account_id=context.account_id, email="test@example.com", old_email="test@example.com", code="123456"
        )
    )
    with pytest.raises(InvalidEmailError):
        verify_change_email_code(service, context, {"email": "other@example.com", "code": "123456", "token": token})
    with pytest.raises(EmailCodeError):
        verify_change_email_code(service, context, {"email": "test@example.com", "code": "wrong", "token": token})
    transports.failures["test@example.com"] = 5
    with pytest.raises(EmailChangeLimitError):
        verify_change_email_code(service, context, {"email": "test@example.com", "code": "123456", "token": token})
    assert token in transports.tokens


@pytest.mark.parametrize(
    ("freeze_type", "http_error"),
    [
        ("frozen", AccountInFreezeError),
        ("email_domain_suspended", EmailDomainSuspendedError),
        (None, EmailAlreadyInUseError),
    ],
)
def test_shared_reset_and_availability_policy_errors(
    service: AccountChangeEmailService,
    context: AccountRequestContext | RequestContext,
    transports: AccountEmailTransports,
    freeze_type: str | None,
    http_error: type[Exception],
) -> None:
    if freeze_type is not None:
        transports.frozen["other@example.com"] = freeze_type
    token = transports.issue(
        AccountChangeEmailNewEmailVerifiedToken(
            account_id=context.account_id, email="other@example.com", old_email="test@example.com", code="123456"
        )
    )
    with pytest.raises(http_error):
        check_change_email_available(service, {"email": "other@example.com"})
    with pytest.raises(http_error):
        reset_change_email(service, context, {"new_email": "other@example.com", "token": token})
    assert token in transports.tokens
    assert transports.completed == []


def test_missing_account_errors_remain_surface_specific(
    service: AccountChangeEmailService,
    context: AccountRequestContext | RequestContext,
    transports: AccountEmailTransports,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.delete(session.get_one(Account, context.account_id))
    with pytest.raises(AccountNotFoundError):
        send_change_email_code(service, context, {"email": "test@example.com"}, ip_address="127.0.0.1")
    token = transports.issue(
        AccountChangeEmailNewEmailVerifiedToken(
            account_id=context.account_id, email="new@example.com", old_email="test@example.com", code="123456"
        )
    )
    with pytest.raises(AccountNotFoundError):
        reset_change_email(service, context, {"new_email": "new@example.com", "token": token})
    assert transports.sent == []
    assert transports.completed == []
