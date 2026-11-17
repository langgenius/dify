"""Unit tests for controllers.web.feature endpoints."""

import pytest
from flask import Flask
from pydantic import ValidationError

from controllers.console import bp as console_bp
from controllers.web import bp as web_bp
from controllers.web.feature import WebSystemFeatureResponse
from enums import DeploymentEdition
from extensions.ext_application_services import ApplicationServices
from services.entities.feature_entities import SystemFeatureModel
from tests.helpers.unit.config_override import apply_config_overrides


@pytest.mark.parametrize("login_enabled", [True, False])
@pytest.mark.parametrize("console_url", ["https://console.example.com", "https://console.example.com/base///", ""])
def test_public_system_features_exposes_web_account_login_url(
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
    login_enabled: bool,
    console_url: str,
) -> None:
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        WEBAPP_ACCOUNT_PASSPORT_ENABLED=login_enabled,
        CONSOLE_WEB_URL=console_url,
        LOGIN_DISABLED=False,
    )
    app = Flask(__name__)
    app.extensions["application_services"] = account_application_services
    app.register_blueprint(web_bp)
    app.register_blueprint(console_bp)
    client = app.test_client()

    response = client.get("/api/system-features")
    console_response = client.get("/console/api/system-features")

    assert response.status_code == console_response.status_code == 200
    payload = response.get_json()
    console_payload = console_response.get_json()
    console_payload.pop("webapp_url")
    assert payload == {
        **console_payload,
        "account_login_url": f"{console_url.rstrip('/')}/signin" if login_enabled else None,
    }
    assert "account_login_url" not in console_response.get_json()
    assert "webapp_url" not in payload
    assert "Set-Cookie" not in response.headers
    assert client.get("/api/account/profile").status_code == 401


@pytest.mark.parametrize("deployment_edition", list(DeploymentEdition))
def test_web_system_features_preserves_shared_bootstrap(deployment_edition: DeploymentEdition) -> None:
    features = SystemFeatureModel(agent_tracing_api_collection_enabled=False, deployment_edition=deployment_edition)

    response = WebSystemFeatureResponse(**features.model_dump(mode="json"), account_login_url=None)

    assert response.model_dump(mode="json") == {**features.model_dump(mode="json"), "account_login_url": None}


def test_web_system_features_schema_requires_nullable_login_url() -> None:
    schema = WebSystemFeatureResponse.model_json_schema(mode="serialization")

    assert "account_login_url" in schema["required"]
    assert schema["properties"]["account_login_url"]["anyOf"] == [{"type": "string"}, {"type": "null"}]
    assert "default" not in schema["properties"]["account_login_url"]
    assert "account_login_url" not in SystemFeatureModel.model_json_schema(mode="serialization")["properties"]


def test_web_system_features_cannot_default_missing_login_url_to_disabled() -> None:
    with pytest.raises(ValidationError) as error:
        WebSystemFeatureResponse.model_validate(
            {"deployment_edition": DeploymentEdition.COMMUNITY, "agent_tracing_api_collection_enabled": False}
        )

    assert error.value.errors(include_input=False)[0]["loc"] == ("account_login_url",)
