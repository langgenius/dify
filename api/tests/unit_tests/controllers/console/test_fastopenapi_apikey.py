import builtins
from dataclasses import dataclass
from datetime import UTC, datetime

import pytest
from flask import Flask
from flask.views import MethodView

from controllers.console import apikey as apikey_module
from controllers.console import wraps as console_wraps
from extensions import ext_fastopenapi
from libs import login as login_lib
from models.account import Account, TenantAccountRole

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@dataclass
class FakeApiToken:
    id: str
    type: str
    token: str
    last_used_at: datetime | None
    created_at: datetime


class FakeUserProxy:
    def __init__(self, account: Account) -> None:
        self._account = account

    def _get_current_object(self) -> Account:
        return self._account

    @property
    def has_edit_permission(self) -> bool:
        return True


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


@pytest.fixture
def account() -> Account:
    account = Account(name="Owner", email="owner@example.com")
    account.role = TenantAccountRole.OWNER
    return account


def _configure_auth(monkeypatch: pytest.MonkeyPatch, account: Account) -> None:
    monkeypatch.setattr(console_wraps.dify_config, "EDITION", "CLOUD")
    monkeypatch.setattr(console_wraps, "current_account_with_tenant", lambda: (account, "tenant-id"))
    monkeypatch.setattr(apikey_module, "current_account_with_tenant", lambda: (account, "tenant-id"))
    monkeypatch.setattr(login_lib.dify_config, "LOGIN_DISABLED", True)
    monkeypatch.setattr(login_lib, "check_csrf_token", lambda *args, **kwargs: None)
    monkeypatch.setattr(login_lib, "current_user", FakeUserProxy(account))


@pytest.mark.parametrize(
    "path",
    [
        "/console/api/apps/00000000-0000-0000-0000-000000000001/api-keys",
        "/console/api/datasets/00000000-0000-0000-0000-000000000002/api-keys",
    ],
)
def test_console_apikey_fastopenapi_list(app: Flask, monkeypatch: pytest.MonkeyPatch, account: Account, path: str):
    _configure_auth(monkeypatch, account)
    ext_fastopenapi.init_app(app)

    created_at = datetime(2025, 1, 1, tzinfo=UTC)
    fake_token = FakeApiToken(
        id="token-id",
        type="app",
        token="app-123",
        last_used_at=None,
        created_at=created_at,
    )

    monkeypatch.setattr(apikey_module, "_get_resource", lambda *args, **kwargs: object())
    monkeypatch.setattr(apikey_module, "_list_api_keys", lambda *args, **kwargs: [fake_token])

    client = app.test_client()
    response = client.get(path)

    assert response.status_code == 200
    payload = response.get_json()
    assert payload == {
        "data": [
            {
                "id": "token-id",
                "type": "app",
                "token": "app-123",
                "last_used_at": None,
                "created_at": int(created_at.timestamp()),
            }
        ]
    }


def test_console_apikey_fastopenapi_create_and_delete(app: Flask, monkeypatch: pytest.MonkeyPatch, account: Account):
    _configure_auth(monkeypatch, account)
    ext_fastopenapi.init_app(app)

    created_at = datetime(2025, 1, 2, tzinfo=UTC)
    fake_token = FakeApiToken(
        id="token-id",
        type="app",
        token="app-456",
        last_used_at=None,
        created_at=created_at,
    )

    monkeypatch.setattr(apikey_module, "_get_resource", lambda *args, **kwargs: object())
    monkeypatch.setattr(apikey_module, "_create_api_key", lambda *args, **kwargs: fake_token)
    monkeypatch.setattr(apikey_module, "_delete_api_key", lambda *args, **kwargs: None)

    client = app.test_client()
    response = client.post("/console/api/apps/00000000-0000-0000-0000-000000000001/api-keys")

    assert response.status_code == 201
    assert response.get_json() == {
        "id": "token-id",
        "type": "app",
        "token": "app-456",
        "last_used_at": None,
        "created_at": int(created_at.timestamp()),
    }

    delete_path = "/console/api/apps/00000000-0000-0000-0000-000000000001/api-keys/00000000-0000-0000-0000-000000000003"
    delete_response = client.delete(delete_path)
    assert delete_response.status_code == 204
