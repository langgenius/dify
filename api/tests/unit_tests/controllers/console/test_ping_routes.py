"""Route tests for the console ping endpoint."""

import pytest
from flask import Flask

from controllers.console import bp as console_bp


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(console_bp)
    return app


def test_console_ping_returns_pong(app: Flask):
    client = app.test_client()
    response = client.get("/console/api/ping")

    assert response.status_code == 200
    assert response.get_json() == {"result": "pong"}
