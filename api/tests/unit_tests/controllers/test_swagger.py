"""Swagger JSON rendering tests for Flask-RESTX API blueprints."""

import pytest
from flask import Flask


def test_swagger_json_endpoints_render(monkeypatch: pytest.MonkeyPatch):
    from configs import dify_config
    from controllers.console import bp as console_bp
    from controllers.service_api import bp as service_api_bp
    from controllers.web import bp as web_bp

    monkeypatch.setattr(dify_config, "SWAGGER_UI_ENABLED", True)

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["RESTX_INCLUDE_ALL_MODELS"] = True
    app.register_blueprint(console_bp)
    app.register_blueprint(web_bp)
    app.register_blueprint(service_api_bp)

    client = app.test_client()

    for route in ("/console/api/swagger.json", "/api/swagger.json", "/v1/swagger.json"):
        response = client.get(route)

        assert response.status_code == 200
        payload = response.get_json()
        assert payload["swagger"] == "2.0"
        assert "paths" in payload
        assert "definitions" in payload

    assert app.config["RESTX_INCLUDE_ALL_MODELS"] is True
