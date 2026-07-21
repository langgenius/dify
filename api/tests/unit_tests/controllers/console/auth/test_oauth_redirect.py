import urllib.parse
from unittest.mock import ANY, MagicMock, patch

import pytest
from flask import Flask

from controllers.console.auth.oauth import OAuthCallback, OAuthLogin
from libs.oauth import OAuthUserInfo, encode_oauth_state
from models.account import AccountStatus

REDIRECT_URL = "/apps?category=workflow"
CONSOLE_WEB_URL = "https://console.example.com"


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


def test_oauth_login_passes_relative_redirect_url_through(app: Flask) -> None:
    oauth_provider = MagicMock()
    oauth_provider.get_authorization_url.return_value = "https://accounts.google.com/o/oauth2/v2/auth?state=..."
    query = urllib.parse.urlencode({"redirect_url": REDIRECT_URL})

    with (
        patch("controllers.console.auth.oauth.get_oauth_providers", return_value={"google": oauth_provider}),
        app.test_request_context(f"/oauth/login/google?{query}"),
    ):
        response = OAuthLogin().get("google")

    oauth_provider.get_authorization_url.assert_called_once_with(
        invite_token=None,
        timezone=None,
        language=None,
        redirect_url=REDIRECT_URL,
    )
    assert response.status_code == 302
    assert response.headers["Location"] == "https://accounts.google.com/o/oauth2/v2/auth?state=..."


@pytest.mark.parametrize(
    ("redirect_url", "expected_target_url"),
    [
        (REDIRECT_URL, REDIRECT_URL),
        (f"{CONSOLE_WEB_URL}{REDIRECT_URL}", f"{CONSOLE_WEB_URL}{REDIRECT_URL}"),
        ("https://console.example.com.malicious.example/apps", CONSOLE_WEB_URL),
        ("//malicious.example.com/apps", CONSOLE_WEB_URL),
        ("///malicious.example.com/apps", CONSOLE_WEB_URL),
        (r"\\malicious.example.com/apps", CONSOLE_WEB_URL),
    ],
)
@pytest.mark.parametrize("oauth_new_user", [False, True])
def test_oauth_callback_validates_redirect_url_and_appends_new_user_flag(
    app: Flask,
    redirect_url: str,
    expected_target_url: str,
    oauth_new_user: bool,
) -> None:
    oauth_provider = MagicMock()
    oauth_provider.get_access_token.return_value = "google-access-token"
    oauth_provider.get_user_info.return_value = OAuthUserInfo(
        id="google-user-123",
        name="Test User",
        email="test@example.com",
    )
    account = MagicMock()
    account.status = AccountStatus.ACTIVE
    token_pair = MagicMock()
    token_pair.access_token = "dify-access-token"
    token_pair.refresh_token = "dify-refresh-token"
    token_pair.csrf_token = "dify-csrf-token"
    state = encode_oauth_state(redirect_url=redirect_url)

    with (
        patch("controllers.console.auth.oauth.get_oauth_providers", return_value={"google": oauth_provider}),
        patch("controllers.console.auth.oauth.dify_config.CONSOLE_WEB_URL", CONSOLE_WEB_URL),
        patch("controllers.console.auth.oauth._generate_account", return_value=(account, oauth_new_user)),
        patch("controllers.console.auth.oauth.TenantService.create_owner_tenant_if_not_exist"),
        patch("controllers.console.auth.oauth.AccountService.login", return_value=token_pair),
        patch("controllers.console.auth.oauth.set_access_token_to_cookie"),
        patch("controllers.console.auth.oauth.set_refresh_token_to_cookie"),
        patch("controllers.console.auth.oauth.set_csrf_token_to_cookie"),
        app.test_request_context(f"/oauth/authorize/google?code=test-code&state={state}"),
    ):
        response = OAuthCallback().get("google")

    assert response.status_code == 302
    query_char = "&" if "?" in expected_target_url else "?"
    assert response.headers["Location"] == (
        f"{expected_target_url}{query_char}oauth_new_user={str(oauth_new_user).lower()}"
    )


def test_oauth_callback_with_invitation_establishes_console_session(app: Flask) -> None:
    oauth_provider = MagicMock()
    oauth_provider.get_access_token.return_value = "google-access-token"
    oauth_provider.get_user_info.return_value = OAuthUserInfo(
        id="google-user-123",
        name="Test User",
        email="Invitee@Example.com",
    )
    account = MagicMock()
    account.status = AccountStatus.ACTIVE
    token_pair = MagicMock()
    token_pair.access_token = "dify-access-token"
    token_pair.refresh_token = "dify-refresh-token"
    token_pair.csrf_token = "dify-csrf-token"
    state = encode_oauth_state(invite_token="invite-token")

    with (
        patch("controllers.console.auth.oauth.get_oauth_providers", return_value={"google": oauth_provider}),
        patch("controllers.console.auth.oauth.dify_config.CONSOLE_WEB_URL", CONSOLE_WEB_URL),
        patch("controllers.console.auth.oauth.RegisterService") as register_service,
        patch("controllers.console.auth.oauth.AccountService.link_account_integrate") as link_account,
        patch("controllers.console.auth.oauth.AccountService.login", return_value=token_pair) as login,
        patch("controllers.console.auth.oauth.TenantService.create_owner_tenant_if_not_exist") as create_workspace,
        patch("controllers.console.auth.oauth.set_access_token_to_cookie") as set_access_cookie,
        patch("controllers.console.auth.oauth.set_refresh_token_to_cookie") as set_refresh_cookie,
        patch("controllers.console.auth.oauth.set_csrf_token_to_cookie") as set_csrf_cookie,
        app.test_request_context(f"/oauth/authorize/google?code=test-code&state={state}"),
    ):
        register_service.is_valid_invite_token.return_value = True
        register_service.get_invitation_if_token_valid.return_value = {
            "account": account,
            "data": {
                "account_id": "account-id",
                "email": "invitee@example.com",
                "workspace_id": "workspace-id",
            },
            "tenant": MagicMock(),
        }

        response = OAuthCallback().get("google")

    assert response.status_code == 302
    assert response.headers["Location"] == (f"{CONSOLE_WEB_URL}/signin/invite-settings?invite_token=invite-token")
    link_account.assert_called_once_with("google", "google-user-123", account, session=ANY)
    login.assert_called_once_with(account=account, session=ANY, ip_address=ANY)
    create_workspace.assert_not_called()
    set_access_cookie.assert_called_once_with(ANY, response, "dify-access-token")
    set_refresh_cookie.assert_called_once_with(ANY, response, "dify-refresh-token")
    set_csrf_cookie.assert_called_once_with(ANY, response, "dify-csrf-token")


def test_oauth_callback_with_invitation_rejects_another_account(app: Flask) -> None:
    oauth_provider = MagicMock()
    oauth_provider.get_access_token.return_value = "google-access-token"
    oauth_provider.get_user_info.return_value = OAuthUserInfo(
        id="google-user-123",
        name="Test User",
        email="another@example.com",
    )
    account = MagicMock()
    account.status = AccountStatus.ACTIVE
    state = encode_oauth_state(invite_token="invite-token")

    with (
        patch("controllers.console.auth.oauth.get_oauth_providers", return_value={"google": oauth_provider}),
        patch("controllers.console.auth.oauth.dify_config.CONSOLE_WEB_URL", CONSOLE_WEB_URL),
        patch("controllers.console.auth.oauth.RegisterService") as register_service,
        patch("controllers.console.auth.oauth.AccountService.link_account_integrate") as link_account,
        patch("controllers.console.auth.oauth.AccountService.login") as login,
        patch("controllers.console.auth.oauth.set_access_token_to_cookie") as set_access_cookie,
        patch("controllers.console.auth.oauth.set_refresh_token_to_cookie") as set_refresh_cookie,
        patch("controllers.console.auth.oauth.set_csrf_token_to_cookie") as set_csrf_cookie,
        app.test_request_context(f"/oauth/authorize/google?code=test-code&state={state}"),
    ):
        register_service.is_valid_invite_token.return_value = True
        register_service.get_invitation_if_token_valid.return_value = {
            "account": account,
            "data": {
                "account_id": "account-id",
                "email": "invitee@example.com",
                "workspace_id": "workspace-id",
            },
            "tenant": MagicMock(),
        }

        response = OAuthCallback().get("google")

    query = urllib.parse.parse_qs(urllib.parse.urlparse(response.headers["Location"]).query)
    assert response.status_code == 302
    assert query["message"] == ["This invitation was sent to another account. Please sign in with the invited account."]
    link_account.assert_not_called()
    login.assert_not_called()
    register_service.revoke_token.assert_not_called()
    set_access_cookie.assert_not_called()
    set_refresh_cookie.assert_not_called()
    set_csrf_cookie.assert_not_called()
