"""Unit tests for the email-registration Flask adapter."""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from flask import Flask
from pydantic import ValidationError

from controllers.console import bp as console_bp
from controllers.console.auth.email_register import (
    EmailRegisterCheckApi,
    EmailRegisterResetApi,
    EmailRegisterResetPayload,
    EmailRegisterSendEmailApi,
)
from controllers.console.auth.error import (
    EmailAlreadyInUseError,
    EmailCodeError,
    EmailRegisterLimitError,
    EmailRegisterRateLimitExceededError,
    InvalidEmailError,
    InvalidTokenError,
    PasswordMismatchError,
)
from controllers.console.error import (
    AccountInFreezeError,
    EmailDomainSuspendedError,
    EmailSendIpLimitError,
    SeatsLimitExceeded,
)
from enums import DeploymentEdition
from services.account_email_registration_service import AccountEmailRegistrationService
from services.account_errors import (
    AccountEmailAlreadyInUseError,
    AccountEmailDomainSuspendedError,
    AccountEmailFrozenError,
    EmailRegistrationPasswordMismatchError,
    EmailRegistrationSeatsLimitError,
    EmailRegistrationSendIPLimitedError,
    EmailRegistrationSendRateLimitError,
    EmailRegistrationVerificationLimitError,
    InvalidEmailRegistrationAddressError,
    InvalidEmailRegistrationCodeError,
    InvalidEmailRegistrationTokenError,
)
from services.entities.account_entities import AccountEmailRegistrationVerification, AccountSessionTokens
from services.entities.feature_entities import SystemFeatureModel


@contextmanager
def _request(
    app: Flask,
    service: Mock,
    *,
    path: str,
    payload: dict[str, str],
) -> Generator[None, None, None]:
    services = SimpleNamespace(accounts=SimpleNamespace(email_registration=service))
    features = SystemFeatureModel(
        deployment_edition=DeploymentEdition.CLOUD,
        enable_email_password_login=True,
        is_allow_register=True,
    )
    with (
        patch("controllers.console.auth.email_register.application_services", return_value=services),
        patch("controllers.console.flask_admission.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
        patch("controllers.console.flask_admission.FeatureService.get_system_features", return_value=features),
        patch("controllers.console.auth.email_register.extract_remote_ip", return_value="127.0.0.1"),
        app.test_request_context(path, method="POST", json=payload),
    ):
        yield


def _service() -> Mock:
    return Mock(spec=AccountEmailRegistrationService)


def test_send_email_delegates_with_remote_ip(app: Flask) -> None:
    service = _service()
    service.send_code.return_value = "token-123"

    with _request(
        app,
        service,
        path="/email-register/send-email",
        payload={"email": "Invitee@Example.com", "language": "zh-Hans"},
    ):
        response = EmailRegisterSendEmailApi().post()

    assert response == {"result": "success", "data": "token-123"}
    assert service.send_code.call_args.kwargs == {
        "remote_ip": "127.0.0.1",
        "requested_email": "Invitee@Example.com",
        "requested_language": "zh-Hans",
    }


@pytest.mark.parametrize(
    ("service_error", "http_error"),
    [
        pytest.param(EmailRegistrationSendIPLimitedError(), EmailSendIpLimitError, id="ip-limit"),
        pytest.param(EmailRegistrationSendRateLimitError(1), EmailRegisterRateLimitExceededError, id="send-limit"),
        pytest.param(AccountEmailFrozenError(), AccountInFreezeError, id="frozen"),
        pytest.param(AccountEmailDomainSuspendedError(), EmailDomainSuspendedError, id="suspended-domain"),
    ],
)
def test_send_email_translates_application_errors(
    app: Flask,
    service_error: Exception,
    http_error: type[Exception],
) -> None:
    service = _service()
    service.send_code.side_effect = service_error

    with _request(
        app,
        service,
        path="/email-register/send-email",
        payload={"email": "invitee@example.com"},
    ):
        with pytest.raises(http_error):
            EmailRegisterSendEmailApi().post()


def test_verify_email_code_serializes_application_result(app: Flask) -> None:
    service = _service()
    service.verify_code.return_value = AccountEmailRegistrationVerification(
        email="user@example.com",
        token="verified-token",
    )

    with _request(
        app,
        service,
        path="/email-register/validity",
        payload={"email": "User@Example.com", "code": "123456", "token": "pending-token"},
    ):
        response = EmailRegisterCheckApi().post()

    assert response == {"is_valid": True, "email": "user@example.com", "token": "verified-token"}
    service.verify_code.assert_called_once_with(
        email="User@Example.com",
        code="123456",
        token="pending-token",
    )


@pytest.mark.parametrize(
    ("service_error", "http_error"),
    [
        pytest.param(EmailRegistrationVerificationLimitError(), EmailRegisterLimitError, id="attempt-limit"),
        pytest.param(InvalidEmailRegistrationTokenError(), InvalidTokenError, id="token"),
        pytest.param(InvalidEmailRegistrationAddressError(), InvalidEmailError, id="email"),
        pytest.param(InvalidEmailRegistrationCodeError(), EmailCodeError, id="code"),
    ],
)
def test_verify_email_code_translates_application_errors(
    app: Flask,
    service_error: Exception,
    http_error: type[Exception],
) -> None:
    service = _service()
    service.verify_code.side_effect = service_error

    with _request(
        app,
        service,
        path="/email-register/validity",
        payload={"email": "user@example.com", "code": "wrong", "token": "pending-token"},
    ):
        with pytest.raises(http_error):
            EmailRegisterCheckApi().post()


def test_register_delegates_and_serializes_tokens(app: Flask) -> None:
    service = _service()
    service.register.return_value = AccountSessionTokens(
        access_token="access",
        refresh_token="refresh",
        csrf_token="csrf",
    )

    with _request(
        app,
        service,
        path="/email-register",
        payload={
            "token": "verified-token",
            "new_password": "ValidPass123!",
            "password_confirm": "ValidPass123!",
            "language": "zh-Hans",
            "timezone": "Asia/Shanghai",
        },
    ):
        response = EmailRegisterResetApi().post()

    assert response == {
        "result": "success",
        "data": {"access_token": "access", "refresh_token": "refresh", "csrf_token": "csrf"},
    }
    assert service.register.call_args.kwargs == {
        "remote_ip": "127.0.0.1",
        "token": "verified-token",
        "new_password": "ValidPass123!",
        "password_confirm": "ValidPass123!",
        "language": "zh-Hans",
        "timezone": "Asia/Shanghai",
    }


@pytest.mark.parametrize(
    ("service_error", "http_error"),
    [
        pytest.param(EmailRegistrationPasswordMismatchError(), PasswordMismatchError, id="password"),
        pytest.param(InvalidEmailRegistrationTokenError(), InvalidTokenError, id="token"),
        pytest.param(AccountEmailAlreadyInUseError(), EmailAlreadyInUseError, id="email-in-use"),
        pytest.param(EmailRegistrationSeatsLimitError(), SeatsLimitExceeded, id="seat-limit"),
        pytest.param(AccountEmailFrozenError(), AccountInFreezeError, id="frozen"),
        pytest.param(AccountEmailDomainSuspendedError(), EmailDomainSuspendedError, id="suspended-domain"),
    ],
)
def test_register_translates_application_errors(
    app: Flask,
    service_error: Exception,
    http_error: type[Exception],
) -> None:
    service = _service()
    service.register.side_effect = service_error

    with _request(
        app,
        service,
        path="/email-register",
        payload={
            "token": "verified-token",
            "new_password": "ValidPass123!",
            "password_confirm": "ValidPass123!",
        },
    ):
        with pytest.raises(http_error):
            EmailRegisterResetApi().post()


def test_reset_payload_rejects_invalid_timezone() -> None:
    with pytest.raises(ValidationError):
        EmailRegisterResetPayload.model_validate(
            {
                "token": "token-123",
                "new_password": "ValidPass123!",
                "password_confirm": "ValidPass123!",
                "timezone": "",
            }
        )


def test_invalid_password_is_sanitized_by_real_error_handler(caplog: pytest.LogCaptureFixture) -> None:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(console_bp)
    features = SystemFeatureModel(
        deployment_edition=DeploymentEdition.CLOUD,
        enable_email_password_login=True,
        is_allow_register=True,
    )
    password_marker = "SecretMarker"

    with (
        patch("controllers.console.flask_admission.FeatureService.get_system_features", return_value=features),
        patch("controllers.console.wraps.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
    ):
        response = app.test_client().post(
            "/console/api/email-register",
            json={
                "token": "verified-token",
                "new_password": password_marker,
                "password_confirm": password_marker,
            },
        )

    assert response.status_code == 422
    assert password_marker not in response.get_data(as_text=True)
    assert password_marker not in caplog.text
