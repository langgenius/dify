"""Transport-boundary tests for Console authentication endpoints."""

from __future__ import annotations

import base64
from collections.abc import Callable
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Never

import jwt
import pytest
from flask import Flask, request
from flask_cors import CORS
from werkzeug.exceptions import BadRequest, Forbidden, Unauthorized

import libs.login as login_helpers
from controllers.console import wraps
from controllers.console.auth import login
from controllers.console.auth.error import (
    AuthenticationFailedError,
    EmailCodeError,
    EmailCodeLoginRateLimitExceededError,
    EmailCodeLoginServiceUnavailableError,
    EmailPasswordLoginLimitError,
    InvalidEmailError,
    InvalidTokenError,
    NormalizedEmailAlreadyInUseError,
    PasswordResetRateLimitExceededError,
    TurnstileServiceUnavailableError,
    TurnstileVerificationFailedError,
)
from controllers.console.error import (
    AccountBannedError,
    AccountInFreezeError,
    AccountNotFound,
    EmailDomainSuspendedError,
    EmailSendIpLimitError,
    InvalidAccountPasswordRequestError,
    NotAllowedCreateWorkspace,
    SeatsLimitExceeded,
    WorkspacesLimitExceeded,
)
from enums import DeploymentEdition
from extensions.ext_blueprints import AUTHENTICATED_HEADERS
from services import account_errors
from services.account.console_tokens import issue_console_csrf_token
from services.entities.account_entities import AccountSessionTokens
from services.entities.account_login_entities import (
    EmailCodeLoginCommand,
    EmailCodeSendCommand,
    PasswordLoginCommand,
    PasswordLoginResult,
)

TEST_TOKEN = "00000000-0000-4000-8000-000000000001"
TOKENS = AccountSessionTokens(access_token="access-token", refresh_token="refresh-token", csrf_token="csrf-token")


@dataclass
class FakeAuthenticationService:
    error: account_errors.AccountApplicationError | None = None
    password_commands: list[PasswordLoginCommand] = field(default_factory=list)
    email_code_send_commands: list[EmailCodeSendCommand] = field(default_factory=list)
    email_code_login_commands: list[EmailCodeLoginCommand] = field(default_factory=list)
    reset_arguments: list[tuple[str, str | None, str]] = field(default_factory=list)
    logout_tokens: list[str | None] = field(default_factory=list)
    refresh_tokens: list[str] = field(default_factory=list)
    refresh_request_ids: list[str | None] = field(default_factory=list)
    workspace_found: bool = True

    def _raise_if_needed(self) -> None:
        if self.error is not None:
            raise self.error

    def login_with_password(self, command: PasswordLoginCommand) -> PasswordLoginResult:
        self.password_commands.append(command)
        self._raise_if_needed()
        return PasswordLoginResult(
            tokens=TOKENS if self.workspace_found else None,
            workspace_found=self.workspace_found,
        )

    def logout(self, refresh_token: str | None) -> None:
        self.logout_tokens.append(refresh_token)

    def send_reset_password_email(self, *, email: str, language: str | None, ip_address: str) -> str:
        self.reset_arguments.append((email, language, ip_address))
        self._raise_if_needed()
        return "reset-token"

    def send_email_code(self, command: EmailCodeSendCommand) -> str:
        self.email_code_send_commands.append(command)
        self._raise_if_needed()
        return "email-code-token"

    def login_with_email_code(self, command: EmailCodeLoginCommand) -> AccountSessionTokens:
        self.email_code_login_commands.append(command)
        self._raise_if_needed()
        return TOKENS

    def refresh(self, refresh_token: str, *, request_id: str | None = None) -> AccountSessionTokens:
        self.refresh_tokens.append(refresh_token)
        self.refresh_request_ids.append(request_id)
        self._raise_if_needed()
        return TOKENS


@pytest.fixture(autouse=True)
def admit_authentication_requests(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    monkeypatch.setattr(wraps.SystemFeatureService, "is_email_password_login_enabled", lambda: True)


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch) -> FakeAuthenticationService:
    service = FakeAuthenticationService()
    services = SimpleNamespace(accounts=SimpleNamespace(authentication=service))
    monkeypatch.setattr(login, "application_services", lambda: services)
    monkeypatch.setattr(login, "extract_remote_ip", lambda _request: "127.0.0.1")
    return service


def _encode(value: str) -> str:
    return base64.b64encode(value.encode()).decode()


def test_password_login_parses_input_and_serializes_cookies(
    app: Flask,
    service: FakeAuthenticationService,
) -> None:
    with app.test_request_context(
        "/login",
        method="POST",
        json={
            "email": "User@Example.com",
            "password": _encode("password"),
            "invite_token": "invite-token",
        },
    ):
        response = login.LoginApi().post()

    assert response.json == {"result": "success", "data": None}
    assert service.password_commands == [
        PasswordLoginCommand(
            email="User@Example.com",
            password="password",
            invite_token="invite-token",
            ip_address="127.0.0.1",
        )
    ]
    cookies = response.headers.getlist("Set-Cookie")
    assert any("access_token=" in cookie for cookie in cookies)
    assert any("refresh_token=" in cookie for cookie in cookies)
    assert any("csrf_token=" in cookie for cookie in cookies)


def test_password_login_serializes_missing_workspace(
    app: Flask,
    service: FakeAuthenticationService,
) -> None:
    service.workspace_found = False
    with app.test_request_context(
        "/login",
        method="POST",
        json={"email": "user@example.com", "password": _encode("password")},
    ):
        response = login.LoginApi().post()

    assert response["result"] == "fail"
    assert "workspace not found" in response["data"]


def test_invitation_login_with_empty_password_returns_authentication_failure(
    app: Flask,
    service: FakeAuthenticationService,
) -> None:
    service.error = account_errors.InvalidLoginCredentialsError()
    with app.test_request_context(
        "/login",
        method="POST",
        json={"email": "user@example.com", "password": _encode(""), "invite_token": "invite-token"},
    ):
        with pytest.raises(AuthenticationFailedError):
            login.LoginApi().post()

    assert service.password_commands == [
        PasswordLoginCommand(
            email="user@example.com",
            password="",
            invite_token="invite-token",
            ip_address="127.0.0.1",
        )
    ]


def test_invitation_login_with_weak_password_returns_policy_failure(
    app: Flask,
    service: FakeAuthenticationService,
) -> None:
    service.error = account_errors.InvalidAccountPasswordError("Password must contain letters and numbers")
    with app.test_request_context(
        "/login",
        method="POST",
        json={"email": "user@example.com", "password": _encode("letters-only"), "invite_token": "invite-token"},
    ):
        with pytest.raises(InvalidAccountPasswordRequestError, match="letters and numbers"):
            login.LoginApi().post()


def test_reset_password_delegates_transport_values(app: Flask, service: FakeAuthenticationService) -> None:
    with app.test_request_context(
        "/reset-password",
        method="POST",
        json={"email": "User@Example.com", "language": "zh-Hans"},
    ):
        response = login.ResetPasswordSendEmailApi().post()

    assert response == {"result": "success", "data": "reset-token"}
    assert service.reset_arguments == [("User@Example.com", "zh-Hans", "127.0.0.1")]


def test_email_code_send_delegates_validated_command(app: Flask, service: FakeAuthenticationService) -> None:
    with app.test_request_context(
        "/email-code-login",
        method="POST",
        json={"email": "user@example.com", "turnstile_token": "challenge"},
    ):
        response = login.EmailCodeLoginSendEmailApi().post()

    assert response == {"result": "success", "data": "email-code-token"}
    assert service.email_code_send_commands == [
        EmailCodeSendCommand(
            email="user@example.com",
            language=None,
            turnstile_token="challenge",
            ip_address="127.0.0.1",
        )
    ]


def test_email_code_login_decodes_code_and_serializes_tokens(
    app: Flask,
    service: FakeAuthenticationService,
) -> None:
    with app.test_request_context(
        "/email-code-login/validity",
        method="POST",
        json={
            "email": "User@Example.com",
            "code": _encode("123456"),
            "token": TEST_TOKEN,
            "timezone": "Asia/Singapore",
        },
    ):
        response = login.EmailCodeLoginApi().post()

    assert response.json == {"result": "success"}
    assert service.email_code_login_commands == [
        EmailCodeLoginCommand(
            email="User@Example.com",
            code="123456",
            token=TEST_TOKEN,
            turnstile_token=None,
            language=None,
            timezone="Asia/Singapore",
            ip_address="127.0.0.1",
        )
    ]


@pytest.mark.parametrize("refresh_token", ["client-session", None])
def test_logout_revokes_cookie_without_loading_expired_access(
    app: Flask,
    service: FakeAuthenticationService,
    monkeypatch: pytest.MonkeyPatch,
    refresh_token: str | None,
) -> None:
    monkeypatch.setattr(login, "extract_refresh_token", lambda _request: refresh_token)
    monkeypatch.setattr(
        login_helpers,
        "_resolve_current_user",
        lambda: pytest.fail("Logout must not require a valid access token"),
    )
    with app.test_request_context(
        "/logout", method="POST", headers={"Origin": "http://localhost", "Cookie": "access_token=expired"}
    ):
        response = login.LogoutApi().post()

    assert response.json == {"result": "success"}
    assert service.logout_tokens == [refresh_token]
    cookies = response.headers.getlist("Set-Cookie")
    for name in ("access_token", "refresh_token", "csrf_token"):
        assert any(f"{name}=;" in cookie and "Expires=Thu, 01 Jan 1970" in cookie for cookie in cookies)


@pytest.mark.parametrize("endpoint", [login.LogoutApi, login.RefreshTokenApi])
@pytest.mark.parametrize(
    "origin",
    [
        None,
        "null",
        "https://attacker.example",
        "http://localhost.attacker.example",
        "http://localhost:0",
        "http://localhost/path",
        "http://localhost?query",
        "http://user@localhost",
        "http://localhost:bad",
    ],
)
def test_cookie_session_mutations_reject_untrusted_origin(
    app: Flask,
    service: FakeAuthenticationService,
    config_overrides: Callable[..., None],
    endpoint: type[login.LogoutApi] | type[login.RefreshTokenApi],
    origin: str | None,
) -> None:
    config_overrides(SECRET_KEY="proxy-csrf-test-secret-at-least-32-bytes", CONSOLE_WEB_URL="", CONSOLE_API_URL="")
    csrf = issue_console_csrf_token(TEST_TOKEN)
    refresh = f"v2.{TEST_TOKEN}.{'a' * 32}.{'b' * 64}"
    headers = {"X-CSRF-Token": csrf, "Cookie": f"csrf_token={csrf}; refresh_token={refresh}"}
    if origin is not None:
        headers["Origin"] = origin
    with app.test_request_context("/", method="POST", headers=headers):
        with pytest.raises(Forbidden, match="Origin"):
            endpoint().post()

    assert service.logout_tokens == []
    assert service.refresh_tokens == []


@pytest.mark.parametrize("endpoint", [login.LogoutApi, login.RefreshTokenApi])
@pytest.mark.parametrize("origin", ["https://localhost", "http://localhost:8080"])
def test_same_host_proxy_origin_accepts_expired_signed_csrf_proof(
    app: Flask,
    service: FakeAuthenticationService,
    config_overrides: Callable[..., None],
    endpoint: type[login.LogoutApi] | type[login.RefreshTokenApi],
    origin: str,
) -> None:
    secret = "proxy-csrf-test-secret-at-least-32-bytes"
    config_overrides(SECRET_KEY=secret, CONSOLE_WEB_URL="", CONSOLE_API_URL="", COOKIE_DOMAIN="")
    csrf = jwt.encode({"sub": TEST_TOKEN, "exp": 1, "jti": "c" * 32}, secret, algorithm="HS256")
    refresh = f"v2.{TEST_TOKEN}.{'a' * 32}.{'b' * 64}"
    with app.test_request_context(
        "/",
        method="POST",
        headers={
            "Origin": origin,
            "X-CSRF-Token": csrf,
            "Cookie": f"access_token=expired; csrf_token={csrf}; refresh_token={refresh}",
        },
    ):
        assert endpoint().post().json == {"result": "success"}
        with pytest.raises(Unauthorized, match="CSRF"):
            login_helpers.check_csrf_token(request, TEST_TOKEN)

    assert service.logout_tokens + service.refresh_tokens == [refresh]


@pytest.mark.parametrize(
    "case",
    [
        "missing-header",
        "missing-cookie",
        "mismatched-cookie",
        "bad-signature",
        "wrong-account",
        "malformed-refresh",
        "bad-exp",
        "bad-jti",
        "bad-sub",
        "missing-exp",
        "token-type",
        "token-source",
        "audience",
    ],
)
def test_same_host_proxy_origin_rejects_invalid_csrf_proof(
    app: Flask,
    service: FakeAuthenticationService,
    config_overrides: Callable[..., None],
    case: str,
) -> None:
    secret = "proxy-csrf-test-secret-at-least-32-bytes"
    config_overrides(SECRET_KEY=secret, CONSOLE_WEB_URL="", CONSOLE_API_URL="", COOKIE_DOMAIN="")
    claims: dict[str, str | int] = {"sub": TEST_TOKEN, "exp": 1, "jti": "c" * 32}
    refresh = f"v2.{TEST_TOKEN}.{'a' * 32}.{'b' * 64}"
    if case == "wrong-account":
        claims["sub"] = "11111111-1111-4111-8111-111111111111"
    elif case == "malformed-refresh":
        refresh = f"v2.{TEST_TOKEN}.bad.secret"
    elif case == "bad-exp":
        claims["exp"] = "never"
    elif case == "bad-jti":
        claims["jti"] = 123
    elif case == "bad-sub":
        claims["sub"] = 123
    elif case == "missing-exp":
        del claims["exp"]
    elif case == "token-type":
        claims["token_type"] = "console_access"
    elif case == "token-source":
        claims["token_source"] = "webapp"
    elif case == "audience":
        claims["aud"] = "dify-console"
    csrf = jwt.encode(
        claims, "wrong-key-at-least-32-bytes-for-csrf" if case == "bad-signature" else secret, algorithm="HS256"
    )
    cookie = "different-cookie" if case == "mismatched-cookie" else csrf
    headers = {"Origin": "https://localhost", "Cookie": f"refresh_token={refresh}"}
    if case != "missing-header":
        headers["X-CSRF-Token"] = csrf
    if case != "missing-cookie":
        headers["Cookie"] += f"; csrf_token={cookie}"
    with app.test_request_context("/refresh-token", method="POST", headers=headers):
        with pytest.raises(Forbidden, match="Origin"):
            login.RefreshTokenApi().post()
    assert service.refresh_tokens == []


def test_same_host_proxy_origin_with_csrf_and_missing_refresh_can_log_out(
    app: Flask, service: FakeAuthenticationService, config_overrides: Callable[..., None]
) -> None:
    config_overrides(SECRET_KEY="proxy-csrf-test-secret-at-least-32-bytes", CONSOLE_WEB_URL="", CONSOLE_API_URL="")
    csrf = issue_console_csrf_token(TEST_TOKEN)
    with app.test_request_context(
        "/",
        method="POST",
        headers={"Origin": "https://localhost", "X-CSRF-Token": csrf, "Cookie": f"csrf_token={csrf}"},
    ):
        _, status = login.RefreshTokenApi().post()
        assert status == 401
        assert login.LogoutApi().post().json == {"result": "success"}
    assert service.logout_tokens == [None]
    assert service.refresh_tokens == []


@pytest.mark.parametrize("origin", ["http://localhost:80", "https://CONSOLE.example:443"])
def test_refresh_accepts_normalized_api_or_configured_console_origin(
    app: Flask,
    service: FakeAuthenticationService,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    origin: str,
) -> None:
    config_overrides(CONSOLE_WEB_URL="https://console.example/console")
    monkeypatch.setattr(login, "extract_refresh_token", lambda _request: "old-refresh")
    with app.test_request_context("/refresh-token", method="POST", headers={"Origin": origin}):
        assert login.RefreshTokenApi().post().json == {"result": "success"}
    assert service.refresh_tokens == ["old-refresh"]


@pytest.mark.parametrize("request_id", ["", "not-a-uuid", "x" * 1000])
def test_refresh_rejects_invalid_request_id(app: Flask, service: FakeAuthenticationService, request_id: str) -> None:
    with app.test_request_context(
        "/refresh-token", method="POST", headers={"Origin": "http://localhost", "X-Refresh-Request-ID": request_id}
    ):
        with pytest.raises(BadRequest, match="UUID"):
            login.RefreshTokenApi().post()
    assert service.refresh_tokens == []


def test_refresh_forwards_normalized_retry_id(
    app: Flask, service: FakeAuthenticationService, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(login, "extract_refresh_token", lambda _request: "old-refresh")
    with app.test_request_context(
        "/refresh-token", method="POST", headers={"Origin": "http://localhost", "X-Refresh-Request-ID": TEST_TOKEN}
    ):
        response = login.RefreshTokenApi().post()
    assert response.json == {"result": "success"}
    assert service.refresh_request_ids == [TEST_TOKEN]


def test_console_cors_allows_refresh_retry_id_and_csrf_headers() -> None:
    app = Flask("refresh-cors")
    CORS(app, origins=["https://console.example"], supports_credentials=True, allow_headers=list(AUTHENTICATED_HEADERS))
    app.add_url_rule("/refresh-token", view_func=lambda: "", methods=["POST"])
    response = app.test_client().options(
        "/refresh-token",
        headers={
            "Origin": "https://console.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "X-Refresh-Request-ID,X-CSRF-Token",
        },
    )
    allowed = response.headers["Access-Control-Allow-Headers"].lower()
    assert "x-refresh-request-id" in allowed
    assert "x-csrf-token" in allowed


def test_refresh_maps_invalid_session_to_unauthorized(
    app: Flask,
    service: FakeAuthenticationService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service.error = account_errors.InvalidRefreshTokenError("Invalid refresh token")
    monkeypatch.setattr(login, "extract_refresh_token", lambda _request: "bad-token")

    with app.test_request_context("/refresh-token", method="POST", headers={"Origin": "http://localhost"}):
        response, status = login.RefreshTokenApi().post()

    assert status == 401
    assert response == {"result": "fail", "message": "Invalid refresh token"}


def test_refresh_rejects_missing_cookie(
    app: Flask,
    service: FakeAuthenticationService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(login, "extract_refresh_token", lambda _request: None)

    with app.test_request_context("/refresh-token", method="POST", headers={"Origin": "http://localhost"}):
        response, status = login.RefreshTokenApi().post()

    assert status == 401
    assert response["message"] == "No refresh token provided"
    assert service.refresh_tokens == []


def test_refresh_does_not_require_completed_setup(
    app: Flask,
    service: FakeAuthenticationService,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    monkeypatch.setattr(wraps, "_is_setup_completed", lambda: False)
    monkeypatch.setattr(login, "extract_refresh_token", lambda _request: "old-refresh")

    with app.test_request_context("/refresh-token", method="POST", headers={"Origin": "http://localhost"}):
        response = login.RefreshTokenApi().post()

    assert response.json == {"result": "success"}
    assert service.refresh_tokens == ["old-refresh"]


@pytest.mark.parametrize(
    ("translate", "application_error", "request_error"),
    [
        (
            login._raise_account_state_error,
            account_errors.AccountEmailDomainSuspendedError(),
            EmailDomainSuspendedError,
        ),
        (login._raise_account_state_error, account_errors.AccountEmailFrozenError(), AccountInFreezeError),
        (login._raise_account_state_error, account_errors.LoginAccountBannedError(), AccountBannedError),
        (login._raise_password_login_error, account_errors.LoginRateLimitError(), EmailPasswordLoginLimitError),
        (login._raise_password_login_error, account_errors.InvalidLoginCredentialsError(), AuthenticationFailedError),
        (
            login._raise_password_login_error,
            account_errors.InvalidAccountPasswordError("invalid password"),
            InvalidAccountPasswordRequestError,
        ),
        (login._raise_password_login_error, account_errors.InvalidLoginInvitationEmailError(), InvalidEmailError),
        (login._raise_password_login_error, account_errors.LoginWorkspaceLimitError(), WorkspacesLimitExceeded),
        (login._raise_password_login_error, account_errors.AccountNotFoundError(), AccountNotFound),
        (
            login._raise_reset_password_email_error,
            account_errors.ResetPasswordEmailRateLimitError(1),
            PasswordResetRateLimitExceededError,
        ),
        (login._raise_email_code_send_error, account_errors.EmailCodeSendIPLimitedError(), EmailSendIpLimitError),
        (
            login._raise_email_code_send_error,
            account_errors.EmailCodeSendRateLimitError(5),
            EmailCodeLoginRateLimitExceededError,
        ),
        (
            login._raise_email_code_send_error,
            account_errors.HumanVerificationRejectedError(),
            TurnstileVerificationFailedError,
        ),
        (
            login._raise_email_code_send_error,
            account_errors.HumanVerificationUnavailableError(),
            TurnstileServiceUnavailableError,
        ),
        (
            login._raise_email_code_send_error,
            account_errors.EmailCodeLoginUnavailableError(),
            EmailCodeLoginServiceUnavailableError,
        ),
        (login._raise_email_code_login_error, account_errors.InvalidEmailCodeTokenError(), InvalidTokenError),
        (login._raise_email_code_login_error, account_errors.EmailCodeEmailMismatchError(), InvalidEmailError),
        (login._raise_email_code_login_error, account_errors.InvalidEmailCodeError(), EmailCodeError),
        (
            login._raise_email_code_login_error,
            account_errors.HumanVerificationRejectedError(),
            TurnstileVerificationFailedError,
        ),
        (
            login._raise_email_code_login_error,
            account_errors.EmailCodeLoginUnavailableError(),
            EmailCodeLoginServiceUnavailableError,
        ),
        (login._raise_email_code_login_error, account_errors.AccountNotFoundError(), AccountNotFound),
        (login._raise_email_code_login_error, account_errors.LoginWorkspaceLimitError(), WorkspacesLimitExceeded),
        (
            login._raise_email_code_login_error,
            account_errors.LoginWorkspaceCreationNotAllowedError(),
            NotAllowedCreateWorkspace,
        ),
        (login._raise_email_code_login_error, account_errors.LoginSeatLimitError(), SeatsLimitExceeded),
        (
            login._raise_email_code_login_error,
            account_errors.AccountNormalizedEmailAlreadyInUseError(),
            NormalizedEmailAlreadyInUseError,
        ),
        # Every flow-specific translator falls back to the shared account-state mapping.
        (login._raise_email_code_login_error, account_errors.AccountEmailFrozenError(), AccountInFreezeError),
    ],
)
def test_maps_application_errors_to_transport_errors(
    translate: Callable[[account_errors.AccountApplicationError], Never],
    application_error: account_errors.AccountApplicationError,
    request_error: type[Exception],
) -> None:
    with pytest.raises(request_error):
        translate(application_error)


def test_flow_translators_only_map_what_their_flow_raises() -> None:
    """A reset-password error cannot reach the password login flow, so it passes through unmapped."""
    error = account_errors.ResetPasswordEmailRateLimitError(1)
    with pytest.raises(account_errors.ResetPasswordEmailRateLimitError) as raised:
        login._raise_password_login_error(error)
    assert raised.value is error
