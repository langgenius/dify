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
    return app


def test_console_setup_fastopenapi_get_not_started(app: Flask):
    ext_fastopenapi.init_app(app)

    with (
        patch("controllers.console.setup.dify_config.EDITION", "SELF_HOSTED"),
        patch("controllers.console.setup.get_setup_status", return_value=None),
    ):
        client = app.test_client()
        response = client.get("/console/api/setup")

    assert response.status_code == 200
    assert response.get_json() == {"step": "not_started", "setup_at": None}


def test_console_setup_fastopenapi_post_success(app: Flask):
    ext_fastopenapi.init_app(app)

    payload = {
        "email": "admin@example.com",
        "name": "Admin",
        "password": "Passw0rd1",
        "language": "en-US",
    }

    with (
        patch("controllers.console.wraps.dify_config.EDITION", "SELF_HOSTED"),
        patch("controllers.console.setup.get_setup_status", return_value=None),
        patch("controllers.console.setup.TenantService.get_tenant_count", return_value=0),
        patch("controllers.console.setup.get_init_validate_status", return_value=True),
        patch("controllers.console.setup.RegisterService.setup"),
    ):
        client = app.test_client()
        response = client.post("/console/api/setup", json=payload)

    assert response.status_code == 201
    assert response.get_json() == {"result": "success"}
