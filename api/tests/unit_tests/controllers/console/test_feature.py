from inspect import unwrap
from types import SimpleNamespace
from typing import Never
from unittest.mock import MagicMock, create_autospec

import pytest
from flask import Flask
from flask_restx import Api
from pydantic import ValidationError
from pytest_mock import MockerFixture

from controllers.console import feature, wraps
from controllers.web.feature import SystemFeatureApi as WebSystemFeatureApi
from enums import DeploymentEdition
from extensions.ext_application_services import ApplicationServices
from extensions.ext_login import DifyLoginManager
from libs import login
from machinery.context import RequestContext
from models.account import AccountStatus
from services.entities.feature_entities import (
    FeatureModel,
    LicenseLimitationModel,
    LicenseModel,
    LicenseStatus,
    LimitationModel,
    SystemFeatureModel,
    VectorSpaceLimitationModel,
)
from services.feature_query_service import FeatureQueryService
from services.feature_service import FeatureService
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_account, make_tenant


def _request_context() -> RequestContext:
    return RequestContext(
        request_id="request_123",
        trace_id=None,
        account_id="account_123",
        active_workspace_id="tenant_123",
    )


def _install_application_services(mocker: MockerFixture) -> MagicMock:
    feature_queries = create_autospec(FeatureQueryService, instance=True, spec_set=True)
    services = SimpleNamespace(feature_queries=feature_queries)
    mocker.patch("controllers.console.feature.application_services", return_value=services)
    return feature_queries


class TestFeatureApi:
    def test_get_tenant_features_success(self, mocker: MockerFixture) -> None:
        from controllers.console.feature import FeatureApi

        features = FeatureModel(
            apps=LimitationModel(size=3, limit=10),
            vector_space=LimitationModel(size=1, limit=2),
            next_credit_reset_date=1775001600,
        )
        feature_queries = _install_application_services(mocker)
        get_features = feature_queries.get_features
        get_features.return_value = features

        api = FeatureApi()

        raw_get = unwrap(FeatureApi.get)
        request_context = _request_context()
        result = raw_get(api, request_context)

        assert result == features.model_dump(mode="json")
        assert result["apps"] == {"size": 3, "limit": 10}
        retired_fields = {
            "vector_space",
            "next_credit_reset_date",
            "docs_processing",
            "knowledge_rate_limit",
            "dataset_operator_enabled",
        }
        schema = FeatureModel.model_json_schema(mode="serialization")
        assert retired_fields.isdisjoint(result)
        assert set(schema["properties"]) == set(schema["required"]) == set(result)
        get_features.assert_called_once_with(request_context)


class TestFeatureVectorSpaceApi:
    def test_get_vector_space_success(self, mocker: MockerFixture) -> None:
        from controllers.console.feature import FeatureVectorSpaceApi

        feature_queries = _install_application_services(mocker)
        get_vector_space = feature_queries.get_vector_space
        get_vector_space.return_value = VectorSpaceLimitationModel(size=5120, limit=20480)

        api = FeatureVectorSpaceApi()

        raw_get = unwrap(FeatureVectorSpaceApi.get)
        request_context = _request_context()
        result = raw_get(api, request_context)

        assert result == {"size": 5120, "limit": 20480}
        get_vector_space.assert_called_once_with(request_context)

    def test_get_vector_space_preserves_unknown_usage(self, mocker: MockerFixture) -> None:
        from controllers.console.feature import FeatureVectorSpaceApi

        feature_queries = _install_application_services(mocker)
        get_vector_space = feature_queries.get_vector_space
        get_vector_space.return_value = VectorSpaceLimitationModel(size=0, limit=50, usage_unknown=True)

        request_context = _request_context()
        result = unwrap(FeatureVectorSpaceApi.get)(FeatureVectorSpaceApi(), request_context)

        assert result == {"size": 0, "limit": 50, "usage_unknown": True}
        get_vector_space.assert_called_once_with(request_context)

    def test_vector_space_response_schema_marks_usage_unknown_optional(self) -> None:
        schema = VectorSpaceLimitationModel.model_json_schema(mode="serialization")

        assert schema["required"] == ["size", "limit"]
        assert schema["properties"]["usage_unknown"]["type"] == "boolean"
        assert "usage_unknown" not in schema["required"]


class TestTrialModelsApi:
    def test_get_trial_models_success(self, mocker: MockerFixture) -> None:
        from controllers.console.feature import TrialModelsApi

        feature_queries = _install_application_services(mocker)
        get_trial_models = feature_queries.get_trial_models
        get_trial_models.return_value = ["langgenius/openai/openai"]

        api = TrialModelsApi()

        raw_get = unwrap(TrialModelsApi.get)
        request_context = _request_context()
        result = raw_get(api, request_context)

        assert result == {"trial_models": ["langgenius/openai/openai"]}
        get_trial_models.assert_called_once_with(request_context)


class TestAppDslVersionApi:
    def test_get_app_dsl_version_success(self, mocker: MockerFixture) -> None:
        from controllers.console.feature import AppDslVersionApi

        feature_queries = _install_application_services(mocker)
        get_app_dsl_version = feature_queries.get_app_dsl_version
        get_app_dsl_version.return_value = "0.6.0"

        api = AppDslVersionApi()

        result = api.get()

        assert result == {"app_dsl_version": "0.6.0"}
        get_app_dsl_version.assert_called_once_with()


class TestSystemFeatureApi:
    def test_get_system_features_public(self, mocker: MockerFixture) -> None:
        """The public endpoint returns system features without any authentication input."""

        from controllers.console.feature import SystemFeatureApi

        system_features = SystemFeatureModel(
            agent_tracing_api_collection_enabled=False,
            deployment_edition=DeploymentEdition.COMMUNITY,
            is_allow_register=True,
            enable_learn_app=True,
        )
        feature_queries = _install_application_services(mocker)
        get_system_features = feature_queries.get_public_system_features
        get_system_features.return_value = system_features

        api = SystemFeatureApi()
        result = api.get()

        assert result == system_features.model_dump()
        assert result["is_allow_register"] is True
        assert result["enable_learn_app"] is True
        assert result["license"] == {"status": LicenseStatus.NONE}
        assert result["sso_enforced_for_signin_protocol"] is None
        assert result["webapp_auth"]["sso_config"]["protocol"] is None
        get_system_features.assert_called_once_with()


class TestSystemFeatureLicenseApi:
    def test_get_license_success(self, mocker: MockerFixture) -> None:
        from controllers.console.feature import SystemFeatureLicenseApi

        license_model = LicenseModel(
            status=LicenseStatus.ACTIVE,
            expired_at="2025-12-31",
            seats=LicenseLimitationModel(enabled=True, limit=5, size=2),
        )
        feature_queries = _install_application_services(mocker)
        get_license = feature_queries.get_license
        get_license.return_value = license_model

        api = SystemFeatureLicenseApi()
        raw_get = unwrap(SystemFeatureLicenseApi.get)
        result = raw_get(api, _request_context())

        assert result == license_model.model_dump()
        assert result["seats"] == {"enabled": True, "limit": 5, "size": 2}
        get_license.assert_called_once_with()


"""Public deployment discovery is independent of workspace tracing configuration."""


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
