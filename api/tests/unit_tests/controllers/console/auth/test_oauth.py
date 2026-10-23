from collections.abc import Callable
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import NoReturn
from urllib.parse import parse_qs, urlencode, urlsplit

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden, UnprocessableEntity

from controllers.console import wraps as console_wraps
from controllers.console.auth import oauth as oauth_controller
from controllers.console.auth.oauth import OAuthCallback, OAuthLogin
from enums import DeploymentEdition
from libs.oauth import AccountOAuthState, decode_account_oauth_state, encode_account_oauth_state, encode_oauth_state
from services.account_errors import (
    InvalidOAuthProviderError,
    OAuthIdentityLockUnavailableError,
    OAuthInvitationAccountMismatchError,
    OAuthProviderRequestError,
    OAuthRegistrationError,
)
from services.entities.account_entities import AccountSessionTokens
from services.entities.account_oauth_entities import (
    OAuthAuthorizationRequest,
    OAuthCallbackCommand,
    OAuthCallbackResult,
    OAuthInvitationResult,
    OAuthSignInResult,
)
from services.system_feature_service import SystemFeatureService

CONSOLE_WEB_URL = "https://console.example.com"


@dataclass
class FakeOAuthService:
    authorization_url: str = "https://provider.example/authorize"
    callback_result: OAuthCallbackResult = OAuthSignInResult(
        tokens=AccountSessionTokens("access-token", "refresh-token", "csrf-token"),
        oauth_new_user=False,
    )
    authorization_error: Exception | None = None
    callback_error: Exception | None = None
    authorization_calls: list[tuple[str, OAuthAuthorizationRequest]] = field(default_factory=list)
    callback_calls: list[OAuthCallbackCommand] = field(default_factory=list)

    def start_authorization(self, provider: str, request: OAuthAuthorizationRequest) -> str:
        self.authorization_calls.append((provider, request))
        if self.authorization_error is not None:
            raise self.authorization_error
        return self.authorization_url

    def complete_authorization(self, command: OAuthCallbackCommand) -> OAuthCallbackResult:
        self.callback_calls.append(command)
        if self.callback_error is not None:
            raise self.callback_error
        return self.callback_result


@pytest.fixture(autouse=True)
def _oauth_admission(
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        ENABLE_SOCIAL_OAUTH_LOGIN=True,
        CONSOLE_WEB_URL=CONSOLE_WEB_URL,
    )


def _install_service(monkeypatch: pytest.MonkeyPatch, service: FakeOAuthService) -> None:
    services = SimpleNamespace(accounts=SimpleNamespace(oauth=service))
    monkeypatch.setattr(oauth_controller, "application_services", lambda: services)


def test_login_parses_input_and_delegates_to_application_service(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = FakeOAuthService()
    _install_service(monkeypatch, service)

    with app.test_request_context(
        "/oauth/login/github?invite_token=invite&timezone=Asia%2FShanghai&language=zh-Hans&redirect_url=%2Fapps"
    ):
        response = OAuthLogin().get("github")

    assert response.status_code == 302
    assert response.headers["Location"] == "https://provider.example/authorize"
    protected_state = service.authorization_calls[0][1].state
    assert protected_state is not None
    decoded = decode_account_oauth_state(protected_state)
    assert decoded.mode == "console"
    assert decoded.context == {
        "invite_token": "invite",
        "timezone": "Asia/Shanghai",
        "language": "zh-Hans",
        "redirect_url": "/apps",
    }
    assert service.authorization_calls == [
        (
            "github",
            OAuthAuthorizationRequest(
                invite_token="invite",
                timezone="Asia/Shanghai",
                language="zh-Hans",
                redirect_url="/apps",
                state=protected_state,
            ),
        )
    ]


def test_login_returns_adapter_error_for_unknown_provider(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = FakeOAuthService(authorization_error=InvalidOAuthProviderError())
    _install_service(monkeypatch, service)

    with app.test_request_context("/oauth/login/unknown"):
        payload, status = OAuthLogin().get("unknown")

    assert status == 400
    assert payload == {"error": "Invalid provider"}


def test_oauth_admission_does_not_query_enterprise_features(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(console_wraps, "_is_setup_completed", lambda: True)
    service = FakeOAuthService()
    _install_service(monkeypatch, service)

    def unexpected_feature_query() -> NoReturn:
        raise AssertionError("OAuth admission must not query Enterprise features")

    monkeypatch.setattr(SystemFeatureService, "get_license", unexpected_feature_query)

    with app.test_request_context("/oauth/login/github"):
        response = OAuthLogin().get("github")

    assert response.status_code == 302
    assert service.authorization_calls


def test_callback_passes_stable_values_and_serializes_session_cookies(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = FakeOAuthService()
    _install_service(monkeypatch, service)
    cookie_calls: list[tuple[str, str]] = []
    monkeypatch.setattr(oauth_controller, "extract_remote_ip", lambda _request: "203.0.113.10")
    monkeypatch.setattr(
        oauth_controller,
        "set_access_token_to_cookie",
        lambda _request, _response, token: cookie_calls.append(("access", token)),
    )
    monkeypatch.setattr(
        oauth_controller,
        "set_refresh_token_to_cookie",
        lambda _request, _response, token: cookie_calls.append(("refresh", token)),
    )
    monkeypatch.setattr(
        oauth_controller,
        "set_csrf_token_to_cookie",
        lambda _request, _response, token: cookie_calls.append(("csrf", token)),
    )
    state = encode_oauth_state(
        invite_token="invite",
        timezone="Asia/Shanghai",
        language="zh-Hans",
        redirect_url="/apps",
    )

    with app.test_request_context(
        f"/oauth/authorize/github?code=code-1&state={state}",
        headers={"Accept-Language": "en-US,en;q=0.9"},
    ):
        response = OAuthCallback().get("github")

    assert response.status_code == 302
    assert response.headers["Location"] == "/apps?oauth_new_user=false"
    assert service.callback_calls == [
        OAuthCallbackCommand(
            provider="github",
            code="code-1",
            invite_token="invite",
            timezone="Asia/Shanghai",
            language="zh-Hans",
            browser_language="en-US",
            ip_address="203.0.113.10",
        )
    ]
    assert cookie_calls == [
        ("access", "access-token"),
        ("refresh", "refresh-token"),
        ("csrf", "csrf-token"),
    ]


@pytest.mark.parametrize(
    ("redirect_url", "expected"),
    [
        ("https://console.example.com/apps", "https://console.example.com/apps?oauth_new_user=false"),
        ("https://console.example.com.malicious.example/apps", f"{CONSOLE_WEB_URL}?oauth_new_user=false"),
        ("//malicious.example.com/apps", f"{CONSOLE_WEB_URL}?oauth_new_user=false"),
        ("///malicious.example.com/apps", f"{CONSOLE_WEB_URL}?oauth_new_user=false"),
        (r"\\malicious.example.com/apps", f"{CONSOLE_WEB_URL}?oauth_new_user=false"),
    ],
)
def test_callback_serializes_safe_redirect_target(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    redirect_url: str,
    expected: str,
) -> None:
    service = FakeOAuthService()
    _install_service(monkeypatch, service)
    state = encode_oauth_state(redirect_url=redirect_url)

    with app.test_request_context(f"/oauth/authorize/github?code=code-1&state={state}"):
        response = OAuthCallback().get("github")

    assert response.headers["Location"] == expected


def test_callback_serializes_invitation_completion_target(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tokens = AccountSessionTokens("access-token", "refresh-token", "csrf-token")
    service = FakeOAuthService(callback_result=OAuthInvitationResult(tokens=tokens, invite_token="invite token"))
    _install_service(monkeypatch, service)

    with app.test_request_context("/oauth/authorize/github?code=code-1"):
        response = OAuthCallback().get("github")

    assert response.headers["Location"] == f"{CONSOLE_WEB_URL}/signin/invite-settings?invite_token=invite+token"


def test_callback_rejects_missing_code_before_service_call(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = FakeOAuthService()
    _install_service(monkeypatch, service)

    with app.test_request_context("/oauth/authorize/github"), pytest.raises(UnprocessableEntity):
        OAuthCallback().get("github")

    assert service.callback_calls == []


@pytest.mark.parametrize("error", [OAuthProviderRequestError(), OAuthIdentityLockUnavailableError()])
def test_callback_maps_oauth_processing_error_to_bad_request(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
) -> None:
    service = FakeOAuthService(callback_error=error)
    _install_service(monkeypatch, service)

    with app.test_request_context("/oauth/authorize/github?code=code-1"):
        payload, status = OAuthCallback().get("github")

    assert status == 400
    assert payload == {"error": "OAuth process failed"}


@pytest.mark.parametrize(
    ("error", "expected_query"),
    [
        (
            OAuthInvitationAccountMismatchError("invite-token"),
            "message=This+invitation+was+sent+to+another+account.+Please+sign+in+with+the+invited+account."
            "&invite_token=invite-token",
        ),
        (OAuthRegistrationError("Registration failed"), "message=Registration+failed"),
    ],
)
def test_callback_serializes_application_errors_as_signin_redirects(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    expected_query: str,
) -> None:
    service = FakeOAuthService(callback_error=error)
    _install_service(monkeypatch, service)

    with app.test_request_context("/oauth/authorize/github?code=code-1"):
        response = OAuthCallback().get("github")

    assert response.status_code == 302
    assert response.headers["Location"] == f"{CONSOLE_WEB_URL}/signin?{expected_query}"


def test_oauth_admission_rejects_disabled_social_login(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    service = FakeOAuthService()
    _install_service(monkeypatch, service)
    config_overrides(ENABLE_SOCIAL_OAUTH_LOGIN=False)

    with app.test_request_context("/oauth/login/github"), pytest.raises(Forbidden):
        OAuthLogin().get("github")

    assert service.authorization_calls == []


def _end_user_state(target: str) -> str:
    return encode_account_oauth_state(
        AccountOAuthState(mode="end_user", provider="github", nonce="browser-nonce", context={"redirect_url": target})
    )


@pytest.mark.parametrize("failure", ["tampered", "missing_cookie", "missing_state", "wrong_cookie", "wrong_provider"])
def test_end_user_oauth_rejects_unbound_or_modified_state(
    app: Flask, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], failure: str
) -> None:
    config_overrides(WEBAPP_ACCOUNT_PASSPORT_ENABLED=True, APP_WEB_URL="https://apps.example.com")
    service = FakeOAuthService()
    _install_service(monkeypatch, service)
    state = _end_user_state("https://apps.example.com/chatbot/app-code")
    headers: dict[str, str] = {"Cookie": "account_oauth_github_browser-nonce=browser-nonce"}
    if failure == "tampered":
        state += "invalid"
    elif failure == "missing_cookie":
        headers = {}
    elif failure == "wrong_cookie":
        headers = {"Cookie": "account_oauth_github_browser-nonce=other-browser"}
    elif failure == "missing_state":
        state = ""
    provider = "google" if failure == "wrong_provider" else "github"
    with app.test_request_context(
        f"/oauth/authorize/{provider}", query_string={"code": "code-1", "state": state}, headers=headers
    ):
        with pytest.raises(ValueError, match="[Ss]tate"):
            OAuthCallback().get(provider)
    assert service.callback_calls == []


def test_end_user_oauth_rechecks_feature_flag_at_callback(
    app: Flask, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(WEBAPP_ACCOUNT_PASSPORT_ENABLED=False, APP_WEB_URL="https://apps.example.com")
    service = FakeOAuthService()
    _install_service(monkeypatch, service)
    with (
        app.test_request_context("/oauth/login/github?mode=end_user&redirect_url=/chatbot/app-code"),
        pytest.raises(Forbidden),
    ):
        OAuthLogin().get("github")
    state = _end_user_state("https://apps.example.com/chatbot/app-code")
    with (
        app.test_request_context(
            "/oauth/authorize/github",
            query_string={"code": "code-1", "state": state},
            headers={"Cookie": "account_oauth_github_browser-nonce=browser-nonce"},
        ),
        pytest.raises(Forbidden),
    ):
        OAuthCallback().get("github")
    assert service.authorization_calls == []
    assert service.callback_calls == []


def test_callback_retry_keeps_end_user_mode_and_web_app_return_target(
    app: Flask, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(WEBAPP_ACCOUNT_PASSPORT_ENABLED=True, APP_WEB_URL="https://apps.example.com")
    service = FakeOAuthService(callback_error=OAuthRegistrationError("Try again"))
    _install_service(monkeypatch, service)
    target = "https://apps.example.com/chatbot/app-code?input=a%26b#message"
    resume = f"{CONSOLE_WEB_URL}/signin?{urlencode({'mode': 'end_user', 'redirect_url': target})}"
    state = _end_user_state(resume)
    with app.test_request_context(
        "/oauth/authorize/github",
        query_string={"code": "code-1", "state": state},
        headers={"Cookie": "account_oauth_github_browser-nonce=browser-nonce"},
    ):
        response = OAuthCallback().get("github")
    destination = urlsplit(response.headers["Location"])
    assert destination.netloc == "console.example.com"
    assert destination.path == "/signin"
    assert parse_qs(destination.query) == {"message": ["Try again"], "mode": ["end_user"], "redirect_url": [target]}


@pytest.mark.parametrize("target", ["https://evil.example/signin", "/apps", "//evil.example/signin"])
def test_end_user_oauth_requires_a_console_signin_return_target(
    app: Flask, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], target: str
) -> None:
    config_overrides(WEBAPP_ACCOUNT_PASSPORT_ENABLED=True)
    service = FakeOAuthService()
    _install_service(monkeypatch, service)
    with app.test_request_context("/oauth/login/github", query_string={"mode": "end_user", "redirect_url": target}):
        with pytest.raises(ValueError, match="sign-in page"):
            OAuthLogin().get("github")
    assert service.authorization_calls == []
