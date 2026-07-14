import urllib.parse
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console.auth.oauth import OAuthCallback, OAuthLogin
from libs.oauth import OAuthUserInfo, encode_oauth_state
from models.account import AccountStatus

REDIRECT_URL = "/apps?category=workflow"


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


@pytest.mark.parametrize("oauth_new_user", [False, True])
def test_oauth_callback_appends_new_user_flag_to_relative_original_page(
    app: Flask,
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
    state = encode_oauth_state(redirect_url=REDIRECT_URL)

    with (
        patch("controllers.console.auth.oauth.get_oauth_providers", return_value={"google": oauth_provider}),
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
    assert response.headers["Location"] == f"{REDIRECT_URL}&oauth_new_user={str(oauth_new_user).lower()}"
