"""Expose the API collection gate before a workspace configures any provider."""

import pytest
from flask import Flask
from flask_restx import Api

from controllers.console import feature, wraps
from enums import DeploymentEdition
from extensions.ext_application_services import ApplicationServices
from extensions.ext_login import DifyLoginManager
from libs import login
from models.account import AccountStatus
from services.entities.feature_entities import FeatureModel, SystemFeatureModel
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_account, make_tenant


@pytest.mark.parametrize("enabled", [False, True])
def test_authenticated_features_exposes_gate_without_app_or_provider_configuration(
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
    enabled: bool,
) -> None:
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        OPS_AGENT_TRACE_ENABLED=enabled,
        LOGIN_DISABLED=False,
    )
    account = make_account(status=AccountStatus.ACTIVE)
    account._current_tenant = make_tenant()
    monkeypatch.setattr(login, "_resolve_current_user", lambda: account)
    monkeypatch.setattr(login, "check_csrf_token", lambda _request, _account_id: None)
    monkeypatch.setattr(wraps, "_is_setup_completed", lambda: True)
    monkeypatch.setattr(feature, "application_services", lambda: account_application_services)
    app = Flask(__name__)
    Api(app).add_resource(feature.FeatureApi, "/console/api/features")

    response = app.test_client().get("/console/api/features")

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["agent_tracing_api_collection_enabled"] is enabled
    assert "tracing_provider" not in payload
    assert "runtime_enabled" not in payload
    assert "queryable" not in payload
    schema = FeatureModel.model_json_schema(mode="serialization")
    assert schema["properties"]["agent_tracing_api_collection_enabled"]["type"] == "boolean"
    assert "agent_tracing_api_collection_enabled" in schema["required"]


def test_feature_gate_is_not_available_without_authentication(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, LOGIN_DISABLED=False, OPS_AGENT_TRACE_ENABLED=True)
    monkeypatch.setattr(wraps, "_is_setup_completed", lambda: True)
    monkeypatch.setattr(login, "_resolve_current_user", lambda: None)

    def forbidden() -> ApplicationServices:
        pytest.fail("anonymous requests must not reach feature queries")

    monkeypatch.setattr(feature, "application_services", forbidden)
    app = Flask(__name__)
    DifyLoginManager(app)
    Api(app).add_resource(feature.FeatureApi, "/console/api/features")

    response = app.test_client().get("/console/api/features")

    assert response.status_code == 401
    assert b"agent_tracing_api_collection_enabled" not in response.data


def test_public_system_features_do_not_expose_the_authenticated_collection_gate() -> None:
    # Console and Web share this public response model.
    public = SystemFeatureModel(deployment_edition=DeploymentEdition.COMMUNITY)
    assert "agent_tracing_api_collection_enabled" not in public.model_dump()
    assert "agent_tracing_api_collection_enabled" not in public.model_json_schema(mode="serialization")["properties"]
