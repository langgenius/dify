from __future__ import annotations

import builtins

import pytest
from flask import Flask
from flask.views import MethodView

from controllers.openapi import bp as openapi_bp
from enums import DeploymentEdition
from tests.helpers.unit.config_override import apply_config_overrides

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


class TestHealthCases:
    @staticmethod
    @pytest.fixture
    def app() -> Flask:
        app = Flask(__name__)
        app.config["TESTING"] = True
        app.register_blueprint(openapi_bp)
        return app

    @staticmethod
    def test_health_returns_ok(app: Flask) -> None:
        client = app.test_client()
        response = client.get("/openapi/v1/_health")

        assert response.status_code == 200
        assert response.get_json() == {"ok": True}

    @staticmethod
    def test_health_path_is_under_openapi_v1_prefix(app: Flask) -> None:
        client = app.test_client()
        assert client.get("/_health").status_code == 404
        assert client.get("/v1/_health").status_code == 404
        assert client.get("/openapi/v1/_health").status_code == 200


"""Meta endpoint /openapi/v1/_version — no auth, returns version + edition."""


class TestMetaVersionCases:
    @staticmethod
    def test_version_endpoint_returns_200_without_auth(openapi_app: Flask) -> None:
        client = openapi_app.test_client()
        response = client.get("/openapi/v1/_version")

        assert response.status_code == 200
        payload = response.get_json()
        assert isinstance(payload, dict)
        assert "version" in payload
        assert "edition" in payload
        assert isinstance(payload["version"], str)
        assert payload["edition"] in {edition.value for edition in DeploymentEdition}

    @staticmethod
    def test_version_endpoint_ignores_bearer_header(openapi_app: Flask) -> None:
        """Endpoint is auth-free — a bogus bearer should not break it."""
        client = openapi_app.test_client()
        response = client.get(
            "/openapi/v1/_version",
            headers={"Authorization": "Bearer total-nonsense"},
        )

        assert response.status_code == 200
        payload = response.get_json()
        assert "version" in payload
        assert "edition" in payload

    @staticmethod
    def test_version_endpoint_reflects_edition_config(openapi_app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)

        client = openapi_app.test_client()
        response = client.get("/openapi/v1/_version")

        assert response.status_code == 200
        assert response.get_json()["edition"] == "CLOUD"

    @staticmethod
    def test_version_endpoint_reflects_enterprise_edition(openapi_app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)

        client = openapi_app.test_client()
        response = client.get("/openapi/v1/_version")

        assert response.status_code == 200
        assert response.get_json()["edition"] == "ENTERPRISE"
