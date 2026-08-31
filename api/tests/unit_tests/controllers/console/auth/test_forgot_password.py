"""Transport-boundary tests for Console forgot-password endpoints."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from flask import Flask

from controllers.console import wraps
from controllers.console.auth import forgot_password
from controllers.console.auth.error import (
    EmailCodeError,
    EmailPasswordResetLimitError,
    InvalidEmailError,
    InvalidTokenError,
    PasswordMismatchError,
    PasswordResetRateLimitExceededError,
)
from controllers.console.error import AccountNotFound, EmailSendIpLimitError
from enums import DeploymentEdition
from services import account_errors
from services.entities.account_entities import ForgotPasswordVerification
from services.entities.feature_entities import SystemFeatureModel
from tests.unit_tests.config_override import apply_config_overrides


class FakeForgotPasswordService:
    def __init__(self) -> None:
        self.error: Exception | None = None
        self.send_arguments: dict[str, str] | None = None
        self.verify_arguments: dict[str, str] | None = None
        self.reset_arguments: dict[str, str] | None = None

    def _raise_if_needed(self) -> None:
        if self.error is not None:
            raise self.error

    def send_code(
        self,
        *,
        email: str,
        language: str,
        ip_address: str,
    ) -> str:
        self.send_arguments = {"email": email, "language": language, "ip_address": ip_address}
        self._raise_if_needed()
        return "reset-token"

    def verify_code(
        self,
        *,
        email: str,
        code: str,
        token: str,
    ) -> ForgotPasswordVerification:
        self.verify_arguments = {"email": email, "code": code, "token": token}
        self._raise_if_needed()
        return ForgotPasswordVerification(email="user@example.com", token="promoted-token")

    def reset(
        self,
        *,
        token: str,
        new_password: str,
        password_confirm: str,
    ) -> None:
        self.reset_arguments = {
            "token": token,
            "new_password": new_password,
            "password_confirm": password_confirm,
        }
        self._raise_if_needed()


@pytest.fixture(autouse=True)
def admit_forgot_password_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    monkeypatch.setattr(
        wraps.FeatureService,
        "get_system_features",
        lambda: SystemFeatureModel(
            deployment_edition=DeploymentEdition.CLOUD,
            enable_email_password_login=True,
        ),
    )


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch) -> FakeForgotPasswordService:
    service = FakeForgotPasswordService()
    services = SimpleNamespace(accounts=SimpleNamespace(forgot_password=service))
    monkeypatch.setattr(forgot_password, "application_services", lambda: services)
    monkeypatch.setattr(forgot_password, "extract_remote_ip", lambda _request: "127.0.0.1")
    return service


def test_send_parses_input_and_serializes_service_result(app: Flask, service: FakeForgotPasswordService) -> None:
    with app.test_request_context(
        "/forgot-password",
        method="POST",
        json={"email": "User@Example.com", "language": "zh-Hans"},
    ):
        response = forgot_password.ForgotPasswordSendEmailApi().post()

    assert response == {"result": "success", "data": "reset-token"}
    assert service.send_arguments == {
        "email": "User@Example.com",
        "language": "zh-Hans",
        "ip_address": "127.0.0.1",
    }


def test_send_defaults_unsupported_language(app: Flask, service: FakeForgotPasswordService) -> None:
    with app.test_request_context(
        "/forgot-password",
        method="POST",
        json={"email": "user@example.com", "language": "fr-FR"},
    ):
        forgot_password.ForgotPasswordSendEmailApi().post()

    assert service.send_arguments is not None
    assert service.send_arguments["language"] == "en-US"


@pytest.mark.parametrize(
    ("service_error", "request_error"),
    [
        (account_errors.ForgotPasswordSendIPLimitedError(), EmailSendIpLimitError),
        (account_errors.ForgotPasswordSendRateLimitError(2), PasswordResetRateLimitExceededError),
    ],
)
def test_send_maps_application_errors(
    app: Flask,
    service: FakeForgotPasswordService,
    service_error: Exception,
    request_error: type[Exception],
) -> None:
    service.error = service_error
    with (
        app.test_request_context(
            "/forgot-password",
            method="POST",
            json={"email": "user@example.com"},
        ),
        pytest.raises(request_error),
    ):
        forgot_password.ForgotPasswordSendEmailApi().post()


def test_verify_serializes_promoted_token(app: Flask, service: FakeForgotPasswordService) -> None:
    with app.test_request_context(
        "/forgot-password/validity",
        method="POST",
        json={"email": "USER@example.com", "code": "123456", "token": "verification-token"},
    ):
        response = forgot_password.ForgotPasswordCheckApi().post()

    assert response == {"is_valid": True, "email": "user@example.com", "token": "promoted-token"}
    assert service.verify_arguments == {
        "email": "USER@example.com",
        "code": "123456",
        "token": "verification-token",
    }


@pytest.mark.parametrize(
    ("service_error", "request_error"),
    [
        (account_errors.ForgotPasswordVerificationLimitError(), EmailPasswordResetLimitError),
        (account_errors.InvalidForgotPasswordTokenError(), InvalidTokenError),
        (account_errors.InvalidForgotPasswordEmailError(), InvalidEmailError),
        (account_errors.InvalidForgotPasswordCodeError(), EmailCodeError),
    ],
)
def test_verify_maps_application_errors(
    app: Flask,
    service: FakeForgotPasswordService,
    service_error: Exception,
    request_error: type[Exception],
) -> None:
    service.error = service_error
    with (
        app.test_request_context(
            "/forgot-password/validity",
            method="POST",
            json={"email": "user@example.com", "code": "123456", "token": "token"},
        ),
        pytest.raises(request_error),
    ):
        forgot_password.ForgotPasswordCheckApi().post()


def test_reset_delegates_and_serializes_result(app: Flask, service: FakeForgotPasswordService) -> None:
    with app.test_request_context(
        "/forgot-password/resets",
        method="POST",
        json={
            "token": "reset-token",
            "new_password": "ValidPass123!",
            "password_confirm": "ValidPass123!",
        },
    ):
        response = forgot_password.ForgotPasswordResetApi().post()

    assert response == {"result": "success"}
    assert service.reset_arguments == {
        "token": "reset-token",
        "new_password": "ValidPass123!",
        "password_confirm": "ValidPass123!",
    }


@pytest.mark.parametrize(
    ("service_error", "request_error"),
    [
        (account_errors.ForgotPasswordMismatchError(), PasswordMismatchError),
        (account_errors.InvalidForgotPasswordTokenError(), InvalidTokenError),
        (account_errors.AccountNotFoundError(), AccountNotFound),
    ],
)
def test_reset_maps_application_errors(
    app: Flask,
    service: FakeForgotPasswordService,
    service_error: Exception,
    request_error: type[Exception],
) -> None:
    service.error = service_error
    with (
        app.test_request_context(
            "/forgot-password/resets",
            method="POST",
            json={
                "token": "reset-token",
                "new_password": "ValidPass123!",
                "password_confirm": "ValidPass123!",
            },
        ),
        pytest.raises(request_error),
    ):
        forgot_password.ForgotPasswordResetApi().post()
