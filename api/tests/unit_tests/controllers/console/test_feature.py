from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import create_autospec

from pytest_mock import MockerFixture

from enums import DeploymentEdition
from machinery.context import RequestContext
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


def _request_context() -> RequestContext:
    return RequestContext(
        request_id="request_123",
        trace_id=None,
        account_id="account_123",
        active_workspace_id="tenant_123",
    )


def _install_application_services(mocker: MockerFixture):
    feature_queries = create_autospec(FeatureQueryService, instance=True, spec_set=True)
    services = SimpleNamespace(feature_queries=feature_queries)
    mocker.patch("controllers.console.feature.application_services", return_value=services)
    return feature_queries


class TestFeatureApi:
    def test_get_tenant_features_success(self, mocker: MockerFixture):
        from controllers.console.feature import FeatureApi

        features = FeatureModel(
            knowledge_rate_limit=42,
            vector_space=LimitationModel(size=1, limit=2),
        )
        feature_queries = _install_application_services(mocker)
        get_features = feature_queries.get_features
        get_features.return_value = features

        api = FeatureApi()

        raw_get = unwrap(FeatureApi.get)
        request_context = _request_context()
        result = raw_get(api, request_context)

        expected = features.model_dump()
        expected.pop("vector_space")
        assert result == expected
        get_features.assert_called_once_with(request_context)


class TestFeatureVectorSpaceApi:
    def test_get_vector_space_success(self, mocker: MockerFixture):
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

    def test_get_vector_space_preserves_unknown_usage(self, mocker: MockerFixture):
        from controllers.console.feature import FeatureVectorSpaceApi

        feature_queries = _install_application_services(mocker)
        get_vector_space = feature_queries.get_vector_space
        get_vector_space.return_value = VectorSpaceLimitationModel(size=0, limit=50, usage_unknown=True)

        request_context = _request_context()
        result = unwrap(FeatureVectorSpaceApi.get)(FeatureVectorSpaceApi(), request_context)

        assert result == {"size": 0, "limit": 50, "usage_unknown": True}
        get_vector_space.assert_called_once_with(request_context)

    def test_vector_space_response_schema_marks_usage_unknown_optional(self):
        schema = VectorSpaceLimitationModel.model_json_schema(mode="serialization")

        assert schema["required"] == ["size", "limit"]
        assert schema["properties"]["usage_unknown"]["type"] == "boolean"
        assert "usage_unknown" not in schema["required"]


class TestTrialModelsApi:
    def test_get_trial_models_success(self, mocker: MockerFixture):
        from controllers.console.feature import TrialModelsApi

        feature_queries = _install_application_services(mocker)
        get_trial_models = feature_queries.get_trial_models
        get_trial_models.return_value = ["langgenius/openai/openai"]

        api = TrialModelsApi()

        raw_get = unwrap(TrialModelsApi.get)
        result = raw_get(api, _request_context())

        assert result == {"trial_models": ["langgenius/openai/openai"]}
        get_trial_models.assert_called_once_with()


class TestAppDslVersionApi:
    def test_get_app_dsl_version_success(self, mocker: MockerFixture):
        from controllers.console.feature import AppDslVersionApi

        feature_queries = _install_application_services(mocker)
        get_app_dsl_version = feature_queries.get_app_dsl_version
        get_app_dsl_version.return_value = "0.6.0"

        api = AppDslVersionApi()

        result = api.get()

        assert result == {"app_dsl_version": "0.6.0"}
        get_app_dsl_version.assert_called_once_with()


class TestSystemFeatureApi:
    def test_get_system_features_public(self, mocker: MockerFixture):
        """The public endpoint returns system features without any authentication input."""

        from controllers.console.feature import SystemFeatureApi

        system_features = SystemFeatureModel(
            deployment_edition=DeploymentEdition.COMMUNITY,
            is_allow_register=True,
            enable_learn_app=True,
        )
        feature_queries = _install_application_services(mocker)
        get_system_features = feature_queries.get_system_features
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
    def test_get_license_success(self, mocker: MockerFixture):
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
