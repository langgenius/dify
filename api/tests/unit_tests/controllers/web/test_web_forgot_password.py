"""Web password-reset transport reuses the shared account use case."""

from inspect import unwrap
from unittest.mock import Mock

import pytest
from flask import Flask

from controllers.console.auth.error import (
    AuthenticationFailedError,
    EmailCodeError,
    InvalidEmailError,
    InvalidTokenError,
    PasswordMismatchError,
)
from controllers.web import forgot_password as controller
from extensions.ext_application_services import AccountServices, ApplicationServices
from services import account_errors
from services.account.forgot_password_service import AccountForgotPasswordService
from services.entities.account_entities import ForgotPasswordVerification
from services.entities.auth_entities import (
    ForgotPasswordCheckPayload,
    ForgotPasswordResetPayload,
    ForgotPasswordSendPayload,
)


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch) -> Mock:
    service = Mock(spec=AccountForgotPasswordService)
    services = Mock(spec=ApplicationServices)
    services.accounts = Mock(spec=AccountServices)
    services.accounts.forgot_password = service
    monkeypatch.setattr(controller, "application_services", lambda: services)
    return service


def test_send_requires_an_existing_account_and_preserves_lookup_case(app: Flask, service: Mock) -> None:
    service.send_code.return_value = "token"
    with app.test_request_context("/", environ_base={"REMOTE_ADDR": "127.0.0.1"}):
        api = controller.ForgotPasswordSendEmailApi()
        result = unwrap(api.post)(api, ForgotPasswordSendPayload(email="User@Example.com", language="zh-Hans"))
    assert result == {"result": "success", "data": "token"}
    service.send_code.assert_called_once_with(
        email="User@Example.com", language="zh-Hans", ip_address="127.0.0.1", require_account=True
    )


def test_send_maps_missing_account(app: Flask, service: Mock) -> None:
    service.send_code.side_effect = account_errors.AccountNotFoundError
    api = controller.ForgotPasswordSendEmailApi()
    with app.test_request_context("/"), pytest.raises(AuthenticationFailedError):
        unwrap(api.post)(api, ForgotPasswordSendPayload(email="user@example.com"))


@pytest.mark.parametrize(
    ("failure", "expected"),
    [
        (account_errors.InvalidForgotPasswordTokenError, InvalidTokenError),
        (account_errors.InvalidForgotPasswordEmailError, InvalidEmailError),
        (account_errors.InvalidForgotPasswordCodeError, EmailCodeError),
    ],
)
def test_verification_maps_failures(service: Mock, failure: type[Exception], expected: type[Exception]) -> None:
    service.verify_code.side_effect = failure
    api = controller.ForgotPasswordCheckApi()
    with pytest.raises(expected):
        unwrap(api.post)(api, ForgotPasswordCheckPayload(email="user@example.com", token="token", code="123456"))


def test_verification_serializes_new_token(service: Mock) -> None:
    service.verify_code.return_value = ForgotPasswordVerification(email="user@example.com", token="promoted")
    api = controller.ForgotPasswordCheckApi()
    response = unwrap(api.post)(api, ForgotPasswordCheckPayload(email="user@example.com", token="token", code="123456"))
    assert response == {"is_valid": True, "email": "user@example.com", "token": "promoted"}


@pytest.mark.parametrize(
    ("failure", "expected"),
    [
        (account_errors.ForgotPasswordMismatchError, PasswordMismatchError),
        (account_errors.InvalidForgotPasswordTokenError, InvalidTokenError),
        (account_errors.AccountNotFoundError, AuthenticationFailedError),
    ],
)
def test_reset_maps_failures(service: Mock, failure: type[Exception], expected: type[Exception]) -> None:
    service.reset.side_effect = failure
    api = controller.ForgotPasswordResetApi()
    with pytest.raises(expected):
        unwrap(api.post)(
            api, ForgotPasswordResetPayload(token="token", new_password="Password123", password_confirm="Password123")
        )
