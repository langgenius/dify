"""Public deployment discovery is independent of workspace tracing configuration."""

from typing import Never

import pytest
from flask import Flask
from flask_restx import Api
from pydantic import ValidationError

from controllers.console import feature, wraps
from controllers.web.feature import SystemFeatureApi as WebSystemFeatureApi
from enums import DeploymentEdition
from extensions.ext_application_services import ApplicationServices
from extensions.ext_login import DifyLoginManager
from libs import login
from models.account import AccountStatus
from services.entities.feature_entities import FeatureModel, SystemFeatureModel
from services.feature_service import FeatureService
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_account, make_tenant


@pytest.mark.parametrize("enabled", [False, True])
@pytest.mark.parametrize("surface", ["console", "web"])
def test_public_system_features_exposes_gate_without_account_app_or_provider(
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
    enabled: bool,
    surface: str,
) -> None:
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        OPS_AGENT_TRACE_ENABLED=enabled,
        LOGIN_DISABLED=False,
    )

    def forbidden_account() -> Never:
        pytest.fail("public deployment discovery must not resolve a Console account")

    def forbidden_workspace(_workspace_id: str, **_kwargs: object) -> Never:
        pytest.fail("public deployment discovery must not query workspace features")

    monkeypatch.setattr(login, "_resolve_current_user", forbidden_account)
    monkeypatch.setattr(FeatureService, "get_features", forbidden_workspace)
    app = Flask(__name__)
    app.extensions["application_services"] = account_application_services
    resource = feature.SystemFeatureApi if surface == "console" else WebSystemFeatureApi
    path = "/console/api/system-features" if surface == "console" else "/api/system-features"
    Api(app).add_resource(resource, path)

    response = app.test_client().get(path)

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["agent_tracing_api_collection_enabled"] is enabled
    assert "tracing_provider" not in payload
    assert "runtime_enabled" not in payload
    assert "queryable" not in payload
    schema = SystemFeatureModel.model_json_schema(mode="serialization")
    gate = schema["properties"]["agent_tracing_api_collection_enabled"]
    assert gate["type"] == "boolean"
    assert "default" not in gate
    assert "agent_tracing_api_collection_enabled" in schema["required"]


@pytest.mark.parametrize("enabled", [False, True])
def test_authenticated_workspace_features_omits_deployment_gate(
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
    assert "agent_tracing_api_collection_enabled" not in payload
    schema = FeatureModel.model_json_schema(mode="serialization")
    assert "agent_tracing_api_collection_enabled" not in schema["properties"]


def test_workspace_features_still_require_authentication(monkeypatch: pytest.MonkeyPatch) -> None:
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


def test_missing_public_gate_cannot_default_to_disabled() -> None:
    with pytest.raises(ValidationError) as error:
        SystemFeatureModel.model_validate({"deployment_edition": DeploymentEdition.COMMUNITY})

    assert error.value.errors(include_input=False)[0]["loc"] == ("agent_tracing_api_collection_enabled",)
