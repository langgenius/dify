import builtins
from unittest.mock import patch

import pytest
from flask import Flask
from flask.views import MethodView

from extensions import ext_fastopenapi

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.secret_key = "test-secret-key"
    return app


def test_console_init_get_returns_finished_when_no_init_password(app: Flask, monkeypatch: pytest.MonkeyPatch):
    ext_fastopenapi.init_app(app)
    monkeypatch.delenv("INIT_PASSWORD", raising=False)

    with patch("controllers.console.init_validate.dify_config.EDITION", "SELF_HOSTED"):
        client = app.test_client()
        response = client.get("/console/api/init")

    assert response.status_code == 200
    assert response.get_json() == {"status": "finished"}


def test_console_init_post_returns_success(app: Flask, monkeypatch: pytest.MonkeyPatch):
    ext_fastopenapi.init_app(app)
    monkeypatch.setenv("INIT_PASSWORD", "test-init-password")

    with (
        patch("controllers.console.init_validate.dify_config.EDITION", "SELF_HOSTED"),
        patch("controllers.console.init_validate.TenantService.get_tenant_count", return_value=0),
    ):
        client = app.test_client()
        response = client.post("/console/api/init", json={"password": "test-init-password"})

    assert response.status_code == 201
    assert response.get_json() == {"result": "success"}
