import builtins
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from flask import Flask
from flask.views import MethodView

from extensions import ext_fastopenapi
from models.account import AccountStatus

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


def _patch_console_auth(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("controllers.console.wraps.dify_config.EDITION", "CLOUD")
    monkeypatch.setattr(
        "controllers.console.wraps.current_account_with_tenant",
        lambda: (SimpleNamespace(status=AccountStatus.ACTIVE), "tenant-id"),
    )
    monkeypatch.setattr("libs.login.check_csrf_token", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("libs.login.current_user", SimpleNamespace(is_authenticated=True, id="user-id"))


def test_console_extension_code_based_fastopenapi_get(app: Flask, monkeypatch: pytest.MonkeyPatch):
    ext_fastopenapi.init_app(app)
    _patch_console_auth(monkeypatch)

    with patch(
        "controllers.console.extension.CodeBasedExtensionService.get_code_based_extension",
        return_value={"ok": True},
    ):
        client = app.test_client()
        response = client.get("/console/api/code-based-extension", query_string={"module": "test.module"})

    assert response.status_code == 200
    assert response.get_json() == {"module": "test.module", "data": {"ok": True}}


def test_console_extension_api_based_fastopenapi_list(app: Flask, monkeypatch: pytest.MonkeyPatch):
    ext_fastopenapi.init_app(app)
    _patch_console_auth(monkeypatch)

    extension = SimpleNamespace(
        id="ext-id",
        name="Extension",
        api_endpoint="https://example.com",
        api_key="secret-key",
        created_at=datetime(2024, 1, 1),
    )

    with (
        patch(
            "controllers.console.extension.current_account_with_tenant",
            return_value=(SimpleNamespace(), "tenant-id"),
        ),
        patch(
            "controllers.console.extension.APIBasedExtensionService.get_all_by_tenant_id",
            return_value=[extension],
        ),
    ):
        client = app.test_client()
        response = client.get("/console/api/api-based-extension")

    assert response.status_code == 200
    assert response.get_json() == {
        "extensions": [
            {
                "id": "ext-id",
                "name": "Extension",
                "api_endpoint": "https://example.com",
                "api_key": "sec******key",
                "created_at": int(extension.created_at.timestamp()),
            }
        ]
    }
