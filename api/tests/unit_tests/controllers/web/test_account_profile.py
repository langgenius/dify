from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask
from flask.testing import FlaskClient

from constants import COOKIE_NAME_ACCESS_TOKEN, COOKIE_NAME_WEBAPP_ACCESS_TOKEN
from controllers.web import bp, login
from machinery.context import AccountRequestContext
from services.account_errors import AccountNotFoundError
from services.consumer_service import ConsumerIdentity
from services.web_identity_service import WebIdentityError
from services.web_passport_service import WebPassportUnauthorizedError
from tests.helpers.unit.config_override import apply_config_overrides


@pytest.fixture
def profile_client(monkeypatch: pytest.MonkeyPatch) -> tuple[FlaskClient, Mock, Mock]:
    profile = Mock()
    consumer = Mock()
    consumer.authenticate.return_value = ConsumerIdentity(account_id="account-1")
    services = SimpleNamespace(accounts=SimpleNamespace(profile=profile), consumer=consumer)
    monkeypatch.setattr(login, "application_services", lambda: services)
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    client = app.test_client()
    client.set_cookie(COOKIE_NAME_WEBAPP_ACCESS_TOKEN, "account-login")
    return client, consumer, profile


@pytest.mark.parametrize("avatar", [None, "https://example.com/avatar.png", "file-id"])
@pytest.mark.parametrize("membership", ["none", "member", "owner"])
def test_profile_returns_console_avatar_fields(
    profile_client: tuple[FlaskClient, Mock, Mock],
    monkeypatch: pytest.MonkeyPatch,
    avatar: str | None,
    membership: str,
) -> None:
    client, consumer, profile = profile_client
    apply_config_overrides(
        monkeypatch,
        WEBAPP_ACCOUNT_PASSPORT_ENABLED=True,
        CONSOLE_WEB_URL="https://console.example.com/base/",
    )
    profile.get.return_value = SimpleNamespace(
        name="Alice",
        avatar=avatar,
        email="private@example.com",
        has_owned_tenant=membership == "owner",
        has_tenant=membership != "none",
    )
    monkeypatch.setattr(login, "build_avatar_url", lambda value: f"signed:{value}" if value == "file-id" else value)

    response = client.get("/api/account/profile")

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.get_json() == {
        "name": "Alice",
        "avatar": avatar,
        "avatar_url": "signed:file-id" if avatar == "file-id" else avatar,
        "has_owned_tenant": membership == "owner",
        "has_tenant": membership != "none",
        "account_login_url": "https://console.example.com/base/signin",
    }
    context = profile.get.call_args.args[0]
    assert isinstance(context, AccountRequestContext)
    assert context.account_id == "account-1"
    consumer.authenticate.assert_called_once_with("account-login")


@pytest.mark.parametrize(
    ("cookie_name", "cookie_value"),
    [
        pytest.param(COOKIE_NAME_ACCESS_TOKEN, "console-login", id="console-cookie"),
        pytest.param(COOKIE_NAME_WEBAPP_ACCESS_TOKEN, None, id="missing-webapp-cookie"),
    ],
)
def test_profile_requires_webapp_account_cookie(
    profile_client: tuple[FlaskClient, Mock, Mock], cookie_name: str, cookie_value: str | None
) -> None:
    client, consumer, profile = profile_client
    client.delete_cookie(COOKIE_NAME_WEBAPP_ACCESS_TOKEN)
    if cookie_value is not None:
        client.set_cookie(cookie_name, cookie_value)
    consumer.authenticate.side_effect = WebIdentityError("Account login required.")

    assert client.get("/api/account/profile").status_code == 401
    consumer.authenticate.assert_called_once_with(None)
    profile.get.assert_not_called()


@pytest.mark.parametrize(
    "error",
    [
        pytest.param(WebIdentityError("Account login required."), id="identity"),
        pytest.param(WebPassportUnauthorizedError("Invalid token."), id="token"),
    ],
)
def test_invalid_webapp_account_login_requires_login(
    profile_client: tuple[FlaskClient, Mock, Mock], error: WebIdentityError | WebPassportUnauthorizedError
) -> None:
    client, consumer, profile = profile_client
    consumer.authenticate.side_effect = error

    assert client.get("/api/account/profile").status_code == 401
    profile.get.assert_not_called()


def test_deleted_account_requires_login(profile_client: tuple[FlaskClient, Mock, Mock]) -> None:
    client, _, profile = profile_client
    profile.get.side_effect = AccountNotFoundError

    assert client.get("/api/account/profile").status_code == 401
