"""Controller-boundary tests for Web login endpoints."""

from dataclasses import dataclass
from inspect import unwrap

import pytest
from flask import Flask

from controllers.console.auth.error import AuthenticationFailedError, EmailCodeError
from controllers.console.error import AccountBannedError
from controllers.web import login
from controllers.web.login import (
    EmailCodeLoginApi,
    EmailCodeLoginSendEmailApi,
    EmailCodeLoginSendPayload,
    EmailCodeLoginVerifyPayload,
    LoginApi,
    LoginPayload,
    LoginStatusApi,
    LoginStatusQuery,
    LogoutApi,
)
from machinery.context import RequestContext
from services.entities.authentication_entities import WebLoginStatus
from services.web_authentication_service import (
    WebAccountBannedError,
    WebAuthenticationFailedError,
    WebInvalidCodeError,
)


@pytest.fixture
def app() -> Flask:
    return Flask(__name__)


@pytest.fixture
def context() -> RequestContext:
    return RequestContext("request-1", "trace-1", "", None, "127.0.0.1")


@dataclass(frozen=True, slots=True)
class ApplicationServicesStub:
    web_authentication: object


def bind_service(monkeypatch: pytest.MonkeyPatch, service: object) -> None:
    monkeypatch.setattr(login, "application_services", lambda: ApplicationServicesStub(web_authentication=service))


class PasswordLoginStub:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.call: tuple[RequestContext, str, str] | None = None

    def login_with_password(self, context: RequestContext, *, email: str, password: str) -> str:
        self.call = (context, email, password)
        if self.error is not None:
            raise self.error
        return "access-token"


def test_password_login_delegates_to_application_service(
    monkeypatch: pytest.MonkeyPatch,
    context: RequestContext,
) -> None:
    service = PasswordLoginStub()
    bind_service(monkeypatch, service)

    result = unwrap(LoginApi.post)(
        LoginApi(),
        LoginPayload(email="User@Example.com", password="Valid1234"),
        context,
    )

    assert result == {"result": "success", "data": {"access_token": "access-token"}}
    assert service.call == (context, "User@Example.com", "Valid1234")


@pytest.mark.parametrize(
    ("service_error", "http_error"),
    [
        pytest.param(WebAccountBannedError(), AccountBannedError, id="banned"),
        pytest.param(WebAuthenticationFailedError(), AuthenticationFailedError, id="credentials"),
    ],
)
def test_password_login_translates_service_errors(
    monkeypatch: pytest.MonkeyPatch,
    context: RequestContext,
    service_error: Exception,
    http_error: type[Exception],
) -> None:
    bind_service(monkeypatch, PasswordLoginStub(service_error))

    with pytest.raises(http_error):
        unwrap(LoginApi.post)(
            LoginApi(),
            LoginPayload(email="user@example.com", password="Valid1234"),
            context,
        )


class LoginStatusStub:
    def __init__(self) -> None:
        self.call: dict[str, str | None] | None = None

    def get_login_status(self, **kwargs: str | None) -> WebLoginStatus:
        self.call = kwargs
        return WebLoginStatus(logged_in=True, app_logged_in=False)


def test_login_status_passes_transport_tokens_to_service(monkeypatch: pytest.MonkeyPatch, app: Flask) -> None:
    service = LoginStatusStub()
    bind_service(monkeypatch, service)
    monkeypatch.setattr(login, "extract_webapp_access_token", lambda _request: "account-token")
    monkeypatch.setattr(login, "extract_webapp_passport", lambda app_code, _request: f"passport:{app_code}")

    with app.test_request_context("/login/status?app_code=site-code"):
        result = unwrap(LoginStatusApi.get)(
            LoginStatusApi(),
            LoginStatusQuery(app_code="site-code", user_id="session-1"),
            RequestContext("request-1", None, "", None, "127.0.0.1"),
        )

    assert result == {"logged_in": True, "app_logged_in": False}
    assert service.call == {
        "app_code": "site-code",
        "user_id": "session-1",
        "access_token": "account-token",
        "app_session_token": "passport:site-code",
    }


class EmailLoginStub:
    def send_email_login_code(self, *, email: str, language: str | None) -> str:
        assert (email, language) == ("User@Example.com", "zh-Hans")
        return "email-token"

    def login_with_email_code(
        self,
        context: RequestContext,
        *,
        email: str,
        code: str,
        token: str,
    ) -> str:
        assert context.remote_ip == "127.0.0.1"
        assert (email, code, token) == ("User@Example.com", "123456", "email-token")
        return "access-token"


def test_email_login_endpoints_delegate_to_application_service(
    monkeypatch: pytest.MonkeyPatch,
    context: RequestContext,
) -> None:
    bind_service(monkeypatch, EmailLoginStub())

    send_result = unwrap(EmailCodeLoginSendEmailApi.post)(
        EmailCodeLoginSendEmailApi(),
        EmailCodeLoginSendPayload(email="User@Example.com", language="zh-Hans"),
        context,
    )
    login_result = unwrap(EmailCodeLoginApi.post)(
        EmailCodeLoginApi(),
        EmailCodeLoginVerifyPayload(email="User@Example.com", code="123456", token="email-token"),
        context,
    )

    assert send_result == {"result": "success", "data": "email-token"}
    assert login_result == {"result": "success", "data": {"access_token": "access-token"}}


def test_email_login_translates_invalid_code(monkeypatch: pytest.MonkeyPatch, context: RequestContext) -> None:
    class InvalidCodeService(EmailLoginStub):
        def login_with_email_code(self, *args, **kwargs) -> str:
            raise WebInvalidCodeError

    bind_service(monkeypatch, InvalidCodeService())

    with pytest.raises(EmailCodeError):
        unwrap(EmailCodeLoginApi.post)(
            EmailCodeLoginApi(),
            EmailCodeLoginVerifyPayload(email="user@example.com", code="bad", token="email-token"),
            context,
        )


def test_logout_only_serializes_response_and_clears_cookie(
    monkeypatch: pytest.MonkeyPatch,
    app: Flask,
    context: RequestContext,
) -> None:
    cleared: list[tuple[str | None, str]] = []

    def clear_cookie(response, *, samesite: str) -> None:
        cleared.append((response.get_json()["result"], samesite))

    monkeypatch.setattr(login, "clear_webapp_access_token_from_cookie", clear_cookie)
    with app.test_request_context("/logout", method="POST"):
        response = unwrap(LogoutApi.post)(LogoutApi(), context)

    assert response.get_json() == {"result": "success"}
    assert cleared == [("success", "None")]
