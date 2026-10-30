from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask

from controllers.web import bp, login, wraps
from machinery.context import AccountRequestContext
from models.model import App, EndUser
from services.account_errors import AccountNotFoundError


@pytest.fixture
def profile_client(monkeypatch: pytest.MonkeyPatch):
    app_model = App(tenant_id="tenant-1")
    end_user = EndUser(account_id="account-1")
    profile = Mock()
    monkeypatch.setattr(wraps, "decode_jwt_token", lambda: (app_model, end_user))
    services = SimpleNamespace(accounts=SimpleNamespace(profile=profile))
    monkeypatch.setattr(login, "application_services", lambda: services)
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    return app.test_client(), end_user, profile


@pytest.mark.parametrize("avatar", [None, "https://example.com/avatar.png", "file-id"])
def test_profile_returns_console_avatar_fields(profile_client, monkeypatch: pytest.MonkeyPatch, avatar: str | None):
    client, _, profile = profile_client
    profile.get.return_value = SimpleNamespace(name="Alice", avatar=avatar, email="private@example.com")
    monkeypatch.setattr(login, "build_avatar_url", lambda value: f"signed:{value}" if value == "file-id" else value)

    response = client.get("/api/account/profile")

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.get_json() == {
        "name": "Alice",
        "avatar": avatar,
        "avatar_url": "signed:file-id" if avatar == "file-id" else avatar,
    }
    context = profile.get.call_args.args[0]
    assert isinstance(context, AccountRequestContext)
    assert context.account_id == "account-1"


def test_anonymous_profile_requires_account(profile_client):
    client, end_user, profile = profile_client
    end_user.account_id = None

    assert client.get("/api/account/profile").status_code == 401
    profile.get.assert_not_called()


def test_deleted_account_requires_login(profile_client):
    client, _, profile = profile_client
    profile.get.side_effect = AccountNotFoundError

    assert client.get("/api/account/profile").status_code == 401
