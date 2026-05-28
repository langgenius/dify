import builtins

import pytest
from flask import Flask
from flask.views import MethodView

from controllers.openapi import bp as openapi_bp

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(openapi_bp)
    return app


def test_health_returns_ok(app: Flask):
    client = app.test_client()
    response = client.get("/openapi/v1/_health")

    assert response.status_code == 200
    assert response.get_json() == {"ok": True}


def test_health_path_is_under_openapi_v1_prefix(app: Flask):
    client = app.test_client()
    assert client.get("/_health").status_code == 404
    assert client.get("/v1/_health").status_code == 404
    assert client.get("/openapi/v1/_health").status_code == 200
