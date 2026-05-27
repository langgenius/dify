from __future__ import annotations

from unittest.mock import patch

from controllers.console.auth.oauth_server import OAuthServerUserAuthorizeApi
from models import Account
from models.account import AccountStatus, TenantAccountRole
from models.model import OAuthProviderApp


def _unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


def _make_account() -> Account:
    account = Account(
        name="Test User",
        email="test@example.com",
        status=AccountStatus.ACTIVE,
    )
    account.id = "account-1"
    account.role = TenantAccountRole.OWNER
    return account


def _make_oauth_provider_app() -> OAuthProviderApp:
    return OAuthProviderApp(
        app_icon="icon",
        client_id="client-1",
        client_secret="secret",
        app_label={"en-US": "Test App"},
        redirect_uris=["https://example.com/callback"],
        scope="read",
    )


def test_oauth_authorize_uses_injected_current_user() -> None:
    api = OAuthServerUserAuthorizeApi()
    method = _unwrap(api.post)
    account = _make_account()
    oauth_provider_app = _make_oauth_provider_app()

    with patch(
        "controllers.console.auth.oauth_server.OAuthServerService.sign_oauth_authorization_code",
        return_value="authorization-code",
    ) as sign_oauth_authorization_code:
        response = method(api, oauth_provider_app, account)

    sign_oauth_authorization_code.assert_called_once_with("client-1", "account-1")
    assert response == {"code": "authorization-code"}
