"""Controller-boundary tests for Web login endpoints."""

from dataclasses import dataclass
from inspect import unwrap
from typing import override
from unittest.mock import MagicMock

import pytest
from flask import Flask, Response
from flask_restx import Api
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session, sessionmaker

from controllers.console import wraps as console_wraps
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
from models.enums import CustomizeTokenStrategy
from models.model import App, AppModelConfig, EndUser, Site
from repositories.webapp_access_query_repository import WebAppAccessQueryRepository
from services.entities.authentication_entities import WebLoginStatus
from services.web_authentication_service import (
    WebAccountBannedError,
    WebAuthenticationFailedError,
    WebAuthenticationService,
    WebInvalidCodeError,
)
from services.webapp_access_query_service import (
    WebAppAccessAppNotFoundError,
    WebAppAccessQueryService,
    WebAppAccessUnavailableError,
)
from tests.unit_tests.config_override import apply_config_overrides


@pytest.fixture
def app() -> Flask:
    return Flask(__name__)


@pytest.fixture
def context() -> RequestContext:
    return RequestContext("request-1", "trace-1", "", "", "127.0.0.1")


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
            RequestContext("request-1", None, "", "", "127.0.0.1"),
        )

    assert result == {"logged_in": True, "app_logged_in": False}
    assert service.call == {
        "app_code": "site-code",
        "user_id": "session-1",
        "access_token": "account-token",
        "app_session_token": "passport:site-code",
    }


@pytest.mark.parametrize(
    ("service_error", "status_code", "error_code"),
    [
        pytest.param(WebAppAccessAppNotFoundError(), 404, "app_not_found", id="unknown-app"),
        pytest.param(WebAppAccessUnavailableError(), 503, "web_app_access_unavailable", id="access-unavailable"),
    ],
)
def test_login_status_translates_access_failures_to_http_errors(
    monkeypatch: pytest.MonkeyPatch,
    app: Flask,
    service_error: Exception,
    status_code: int,
    error_code: str,
) -> None:
    class UnavailableLoginStatusService(LoginStatusStub):
        @override
        def get_login_status(self, **kwargs: str | None) -> WebLoginStatus:
            raise service_error

    bind_service(monkeypatch, UnavailableLoginStatusService())
    monkeypatch.setattr(console_wraps, "_is_setup_completed", lambda: True)
    api = Api(app)
    api.add_resource(LoginStatusApi, "/web/login/status")

    response = app.test_client().get("/web/login/status?app_code=does-not-exist")

    assert response.status_code == status_code
    assert response.get_json()["code"] == error_code


@pytest.mark.parametrize(
    "condition",
    ["missing-site", "dangling-site", "app-disabled", "site-disabled", "app-status-disabled", "unpublished"],
)
def test_unavailable_identity_is_canonical_404_before_authentication(
    condition: str,
    app: Flask,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Keep the IP-access contract across the new Web authentication service boundary."""
    from controllers.web import bp

    app_id = "11111111-1111-1111-1111-111111111111"
    config_id = "22222222-2222-2222-2222-222222222222"
    with sqlite_session_factory.begin() as session:
        if condition != "dangling-site":
            config = AppModelConfig(app_id=app_id)
            config.id = config_id
            session.add(config)
            session.add(
                App(
                    id=app_id,
                    tenant_id=app_id,
                    name="Private fixture",
                    mode="chat",
                    enable_site=condition != "app-disabled",
                    enable_api=True,
                    app_model_config_id=config_id if condition != "unpublished" else None,
                )
            )
        if condition != "missing-site":
            session.add(
                Site(
                    app_id=app_id,
                    code="private-fixture",
                    title="Private fixture",
                    default_language="en-US",
                    customize_token_strategy=CustomizeTokenStrategy.UUID,
                )
            )
        session.flush()
        if condition == "site-disabled":
            session.execute(text("UPDATE sites SET status='disabled' WHERE app_id=:app_id"), {"app_id": app_id})
        elif condition == "app-status-disabled":
            session.execute(text("UPDATE apps SET status='disabled' WHERE id=:app_id"), {"app_id": app_id})

    policy = MagicMock()
    tokens = MagicMock()
    app_sessions = MagicMock()
    access = WebAppAccessQueryService(
        access=WebAppAccessQueryRepository(session_factory=sqlite_session_factory),
        policy=policy,
        webapp_auth_enabled=False,
        get_access_modes=MagicMock(),
        get_user_permissions=MagicMock(),
    )
    service = WebAuthenticationService(
        accounts=MagicMock(),
        passwords=MagicMock(),
        tokens=tokens,
        security=MagicMock(),
        app_access=access,
        app_sessions=app_sessions,
        audit=MagicMock(),
        private_app_access_enabled=False,
    )
    bind_service(monkeypatch, service)
    monkeypatch.setattr(console_wraps, "_is_setup_completed", lambda: True)
    apply_config_overrides(monkeypatch, NETWORK_ACCESS_TRUSTED_PROXY_CIDRS="172.18.0.0/16")
    app.register_blueprint(bp)
    response = app.test_client().get(
        "/api/login/status?app_code=private-fixture", environ_overrides={"REMOTE_ADDR": "203.0.113.42"}
    )

    assert response.status_code == 404
    assert response.data == (
        b'{"client_ip":"203.0.113.42","code":"app_not_found","message":"App not found.","status":404}'
    )
    assert response.headers["Content-Type"] == "application/json"
    assert response.headers["Cache-Control"] == "no-store"
    policy.get_access_mode.assert_not_called()
    tokens.verify_access_token.assert_not_called()
    app_sessions.verify.assert_not_called()
    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(EndUser)) == 0


@pytest.mark.parametrize(
    ("failure", "status"),
    [(WebAppAccessUnavailableError("private dependency"), 503), (TypeError("private bug"), 500)],
)
def test_login_status_dependency_or_bug_is_not_hidden_as_app_404(
    failure: Exception, status: int, app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    from controllers.web import bp

    class FailingLoginStatusService(LoginStatusStub):
        @override
        def get_login_status(self, **kwargs: str | None) -> WebLoginStatus:
            raise failure

    bind_service(monkeypatch, FailingLoginStatusService())
    monkeypatch.setattr(console_wraps, "_is_setup_completed", lambda: True)
    app.register_blueprint(bp)
    response = app.test_client().get("/api/login/status?app_code=fixture")

    assert response.status_code == status
    assert "client_ip" not in response.get_json()
    assert response.get_json()["code"] != "app_not_found"


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
        @override
        def login_with_email_code(
            self,
            context: RequestContext,
            *,
            email: str,
            code: str,
            token: str,
        ) -> str:
            del context, email, code, token
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

    def clear_cookie(response: Response, *, samesite: str) -> None:
        cleared.append((response.get_json()["result"], samesite))

    monkeypatch.setattr(login, "clear_webapp_access_token_from_cookie", clear_cookie)
    with app.test_request_context("/logout", method="POST"):
        response = unwrap(LogoutApi.post)(LogoutApi(), context)

    assert response.get_json() == {"result": "success"}
    assert cleared == [("success", "None")]
