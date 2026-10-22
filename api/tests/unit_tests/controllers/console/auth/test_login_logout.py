"""Transport-boundary tests for Console authentication endpoints."""

from __future__ import annotations

import base64
from collections.abc import Callable
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Never

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

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
from services import account_errors
from services.entities.account_entities import AccountSessionTokens
from services.entities.account_login_entities import (
    EmailCodeLoginCommand,
    EmailCodeSendCommand,
    LoginMode,
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
    logout_account_ids: list[str] = field(default_factory=list)
    refresh_tokens: list[str] = field(default_factory=list)
    refresh_modes: list[LoginMode] = field(default_factory=list)
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

    def logout(self, account_id: str) -> None:
        self.logout_account_ids.append(account_id)

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

    def refresh(self, refresh_token: str, *, mode: LoginMode = LoginMode.CONSOLE) -> AccountSessionTokens:
        self.refresh_modes.append(mode)
        self.refresh_tokens.append(refresh_token)
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


def test_logout_uses_optional_current_account(
    app: Flask,
    service: FakeAuthenticationService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logout_calls: list[bool] = []
    monkeypatch.setattr(login.flask_login, "logout_user", lambda: logout_calls.append(True))
    monkeypatch.setattr(
        login,
        "current_account_with_tenant_optional",
        lambda: (SimpleNamespace(id="account-1"), "workspace-1"),
    )

    with app.test_request_context("/logout", method="POST"):
        response = login.LogoutApi().post()

    assert response.json == {"result": "success"}
    assert service.logout_account_ids == ["account-1"]
    assert logout_calls == [True]


def test_logout_clears_cookies_without_current_account(
    app: Flask,
    service: FakeAuthenticationService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logout_calls: list[bool] = []
    monkeypatch.setattr(login.flask_login, "logout_user", lambda: logout_calls.append(True))
    monkeypatch.setattr(login, "current_account_with_tenant_optional", lambda: (None, None))

    with app.test_request_context("/logout", method="POST"):
        response = login.LogoutApi().post()

    assert response.json == {"result": "success"}
    assert service.logout_account_ids == []
    assert logout_calls == []
    cookies = response.headers.getlist("Set-Cookie")
    assert any("access_token=" in cookie for cookie in cookies)
    assert any("refresh_token=" in cookie for cookie in cookies)
    assert any("csrf_token=" in cookie for cookie in cookies)


def test_refresh_maps_invalid_session_to_unauthorized(
    app: Flask,
    service: FakeAuthenticationService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service.error = account_errors.InvalidRefreshTokenError("Invalid refresh token")
    monkeypatch.setattr(login, "extract_refresh_token", lambda _request: "bad-token")

    with app.test_request_context("/refresh-token", method="POST"):
        response, status = login.RefreshTokenApi().post()

    assert status == 401
    assert response == {"result": "fail", "message": "Invalid refresh token"}


def test_refresh_rejects_missing_cookie(
    app: Flask,
    service: FakeAuthenticationService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(login, "extract_refresh_token", lambda _request: None)

    with app.test_request_context("/refresh-token", method="POST"):
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

    with app.test_request_context("/refresh-token", method="POST"):
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


@pytest.mark.parametrize("endpoint", ["password", "send_code", "verify_code", "refresh"])
@pytest.mark.parametrize("enabled", [False, True])
def test_end_user_login_mode_admission_and_propagation(
    app: Flask,
    service: FakeAuthenticationService,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    endpoint: str,
    enabled: bool,
) -> None:
    config_overrides(WEBAPP_ACCOUNT_PASSPORT_ENABLED=enabled)
    monkeypatch.setattr(login, "extract_refresh_token", lambda _request: "refresh-token")
    payload: dict[str, str]
    if endpoint == "password":
        path, view, payload = (
            "/login",
            login.LoginApi().post,
            {"email": "user@example.com", "password": _encode("Password123")},
        )
    elif endpoint == "send_code":
        path, view, payload = (
            "/email-code-login",
            login.EmailCodeLoginSendEmailApi().post,
            {"email": "user@example.com"},
        )
    elif endpoint == "verify_code":
        path, view, payload = (
            "/email-code-login/validity",
            login.EmailCodeLoginApi().post,
            {"email": "user@example.com", "code": _encode("123456"), "token": TEST_TOKEN},
        )
    else:
        path, view = "/refresh-token", login.RefreshTokenApi().post
        payload = {}
    with app.test_request_context(path, method="POST", json={**payload, "mode": "end_user"}):
        if enabled:
            view()
        else:
            with pytest.raises(Forbidden, match="not enabled"):
                view()
    commands = [*service.password_commands, *service.email_code_send_commands, *service.email_code_login_commands]
    if enabled:
        if endpoint == "refresh":
            assert service.refresh_modes == [LoginMode.END_USER]
        else:
            assert len(commands) == 1
            assert commands[0].mode == LoginMode.END_USER
    else:
        assert commands == []
        assert service.refresh_modes == []


def test_login_mode_contract_preserves_optional_refresh_body(config_overrides: Callable[..., None]) -> None:
    from controllers.console import bp as console_bp

    config_overrides(SWAGGER_UI_ENABLED=True)
    app = Flask(__name__)
    app.config["RESTX_INCLUDE_ALL_MODELS"] = True
    app.register_blueprint(console_bp)
    response = app.test_client().get("/console/api/openapi.json")
    assert response.status_code == 200
    payload = response.get_json()
    refresh = payload["paths"]["/refresh-token"]["post"]
    assert refresh["requestBody"]["required"] is False
    schemas = payload["components"]["schemas"]
    assert schemas["LoginMode"]["enum"] == ["console", "end_user"]
    for schema in (
        "LoginPayload",
        "EmailCodeSendPayload",
        "EmailCodeLoginPayload",
        "RefreshTokenPayload",
        "OAuthLoginQuery",
    ):
        assert schemas[schema]["properties"]["mode"]["default"] == "console"
