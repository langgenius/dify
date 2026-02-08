import builtins

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


def test_console_ping_fastopenapi_returns_pong(app: Flask):
    ext_fastopenapi.init_app(app)

    client = app.test_client()
    response = client.get("/console/api/ping")

    assert response.status_code == 200
    assert response.get_json() == {"result": "pong"}
