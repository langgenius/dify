"""Route tests for the console version endpoint."""

from unittest.mock import patch

import pytest
from flask import Flask

from configs import dify_config
from controllers.console import bp as console_bp


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(console_bp)
    return app


def test_console_version_returns_current_version(app: Flask):
    with patch("controllers.console.version.dify_config.CHECK_UPDATE_URL", None):
        client = app.test_client()
        response = client.get("/console/api/version", query_string={"current_version": "0.0.0"})

    assert response.status_code == 200
    data = response.get_json()
    assert data["version"] == dify_config.project.version
    assert data["release_date"] == ""
    assert data["release_notes"] == ""
    assert data["can_auto_update"] is False
    assert "features" in data
