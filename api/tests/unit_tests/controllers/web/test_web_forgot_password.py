"""Controller-boundary tests for Web forgot-password endpoints."""

from dataclasses import dataclass
from inspect import unwrap
from typing import override

import pytest

from controllers.console.auth.error import EmailCodeError, InvalidTokenError, PasswordMismatchError
from controllers.console.error import EmailSendIpLimitError
from controllers.web import forgot_password
from controllers.web.forgot_password import (
    ForgotPasswordCheckApi,
    ForgotPasswordResetApi,
    ForgotPasswordSendEmailApi,
)
from machinery.context import RequestContext
from services.entities.auth_entities import (
    ForgotPasswordCheckPayload,
    ForgotPasswordResetPayload,
    ForgotPasswordSendPayload,
)
from services.web_authentication_service import (
    WebEmailSendIPLimitedError,
    WebInvalidCodeError,
    WebInvalidTokenError,
    WebPasswordMismatchError,
)


@pytest.fixture
def context() -> RequestContext:
    return RequestContext("request-1", "trace-1", "", None, "127.0.0.1")


@dataclass(frozen=True, slots=True)
class ApplicationServicesStub:
    web_authentication: object


def bind_service(monkeypatch: pytest.MonkeyPatch, service: object) -> None:
    monkeypatch.setattr(
        forgot_password,
        "application_services",
        lambda: ApplicationServicesStub(web_authentication=service),
    )


class ForgotPasswordStub:
    def __init__(self) -> None:
        self.reset_call: tuple[str, str, str] | None = None

    def send_reset_password_email(self, context: RequestContext, *, email: str, language: str | None) -> str:
        assert context.remote_ip == "127.0.0.1"
        assert (email, language) == ("User@Example.com", "zh-Hans")
        return "verification-token"

    def verify_reset_password_code(self, *, email: str, code: str, token: str) -> str:
        assert (email, code, token) == ("User@Example.com", "1234", "verification-token")
        return "reset-token"

    def reset_password(self, *, token: str, new_password: str, password_confirmation: str) -> None:
        self.reset_call = (token, new_password, password_confirmation)


def test_forgot_password_endpoints_delegate_and_serialize(
    monkeypatch: pytest.MonkeyPatch,
    context: RequestContext,
) -> None:
    service = ForgotPasswordStub()
    bind_service(monkeypatch, service)

    send_result = unwrap(ForgotPasswordSendEmailApi.post)(
        ForgotPasswordSendEmailApi(),
        ForgotPasswordSendPayload(email="User@Example.com", language="zh-Hans"),
        context,
    )
    check_result = unwrap(ForgotPasswordCheckApi.post)(
        ForgotPasswordCheckApi(),
        ForgotPasswordCheckPayload(email="User@Example.com", code="1234", token="verification-token"),
        context,
    )
    reset_result = unwrap(ForgotPasswordResetApi.post)(
        ForgotPasswordResetApi(),
        ForgotPasswordResetPayload(
            token="reset-token",
            new_password="ValidPass123!",
            password_confirm="ValidPass123!",
        ),
        context,
    )

    assert send_result == {"result": "success", "data": "verification-token"}
    assert check_result == {"is_valid": True, "email": "user@example.com", "token": "reset-token"}
    assert reset_result == {"result": "success"}
    assert service.reset_call == ("reset-token", "ValidPass123!", "ValidPass123!")


@pytest.mark.parametrize(
    ("method", "service_error", "http_error"),
    [
        pytest.param("send", WebEmailSendIPLimitedError(), EmailSendIpLimitError, id="ip-limit"),
        pytest.param("check", WebInvalidCodeError(), EmailCodeError, id="invalid-code"),
        pytest.param("check", WebInvalidTokenError(), InvalidTokenError, id="invalid-token"),
        pytest.param("reset", WebPasswordMismatchError(), PasswordMismatchError, id="password-mismatch"),
    ],
)
def test_forgot_password_translates_service_errors(
    monkeypatch: pytest.MonkeyPatch,
    context: RequestContext,
    method: str,
    service_error: Exception,
    http_error: type[Exception],
) -> None:
    class ErrorService(ForgotPasswordStub):
        @override
        def send_reset_password_email(
            self,
            context: RequestContext,
            *,
            email: str,
            language: str | None,
        ) -> str:
            if method == "send":
                raise service_error
            return super().send_reset_password_email(context, email=email, language=language)

        @override
        def verify_reset_password_code(self, *, email: str, code: str, token: str) -> str:
            if method == "check":
                raise service_error
            return super().verify_reset_password_code(email=email, code=code, token=token)

        @override
        def reset_password(self, *, token: str, new_password: str, password_confirmation: str) -> None:
            if method == "reset":
                raise service_error
            super().reset_password(
                token=token,
                new_password=new_password,
                password_confirmation=password_confirmation,
            )

    bind_service(monkeypatch, ErrorService())

    def invoke() -> None:
        if method == "send":
            unwrap(ForgotPasswordSendEmailApi.post)(
                ForgotPasswordSendEmailApi(),
                ForgotPasswordSendPayload(email="User@Example.com", language="zh-Hans"),
                context,
            )
        elif method == "check":
            unwrap(ForgotPasswordCheckApi.post)(
                ForgotPasswordCheckApi(),
                ForgotPasswordCheckPayload(email="User@Example.com", code="1234", token="verification-token"),
                context,
            )
        else:
            unwrap(ForgotPasswordResetApi.post)(
                ForgotPasswordResetApi(),
                ForgotPasswordResetPayload(
                    token="reset-token",
                    new_password="ValidPass123!",
                    password_confirm="ValidPass123!",
                ),
                context,
            )

    with pytest.raises(http_error):
        invoke()
