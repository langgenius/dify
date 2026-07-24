from inspect import unwrap

from pytest_mock import MockerFixture

from enums.deployment_edition import DeploymentEdition
from services.feature_service import (
    FeatureModel,
    LicenseLimitationModel,
    LicenseModel,
    LicenseStatus,
    LimitationModel,
    SystemFeatureModel,
)


class TestFeatureApi:
    def test_get_tenant_features_success(self, mocker: MockerFixture):
        from controllers.console.feature import FeatureApi

        features = FeatureModel(
            knowledge_rate_limit=42,
            vector_space=LimitationModel(size=1, limit=2),
        )
        get_features = mocker.patch("controllers.console.feature.FeatureService.get_features")
        get_features.return_value = features

        api = FeatureApi()

        raw_get = unwrap(FeatureApi.get)
        result = raw_get(api, "tenant_123")

        expected = features.model_dump()
        expected.pop("vector_space")
        assert result == expected
        get_features.assert_called_once_with("tenant_123", exclude_vector_space=True)


class TestFeatureVectorSpaceApi:
    def test_get_vector_space_success(self, mocker: MockerFixture):
        from controllers.console.feature import FeatureVectorSpaceApi

        get_vector_space = mocker.patch("controllers.console.feature.FeatureService.get_vector_space")
        get_vector_space.return_value = LimitationModel(size=5120, limit=20480)

        api = FeatureVectorSpaceApi()

        raw_get = unwrap(FeatureVectorSpaceApi.get)
        result = raw_get(api, "tenant_123")

        assert result == {"size": 5120, "limit": 20480}
        get_vector_space.assert_called_once_with("tenant_123")


class TestTrialModelsApi:
    def test_get_trial_models_success(self, mocker: MockerFixture):
        from controllers.console.feature import TrialModelsApi

        get_trial_models = mocker.patch("controllers.console.feature.FeatureService.get_trial_models")
        get_trial_models.return_value = ["langgenius/openai/openai"]

        api = TrialModelsApi()

        raw_get = unwrap(TrialModelsApi.get)
        result = raw_get(api)

        assert result == {"trial_models": ["langgenius/openai/openai"]}
        get_trial_models.assert_called_once_with()


class TestAppDslVersionApi:
    def test_get_app_dsl_version_success(self, mocker: MockerFixture):
        from controllers.console.feature import AppDslVersionApi

        get_app_dsl_version = mocker.patch("controllers.console.feature.FeatureService.get_app_dsl_version")
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
        get_system_features = mocker.patch(
            "controllers.console.feature.FeatureService.get_system_features",
            return_value=system_features,
        )

        api = SystemFeatureApi()
        result = api.get()

        assert result == system_features.model_dump()
        assert result["enable_learn_app"] is True
        assert result["license"] == {"status": LicenseStatus.NONE}
        get_system_features.assert_called_once_with()


class TestSystemFeatureLicenseApi:
    def test_get_license_success(self, mocker: MockerFixture):
        from controllers.console.feature import SystemFeatureLicenseApi

        license_model = LicenseModel(
            status=LicenseStatus.ACTIVE,
            expired_at="2025-12-31",
            seats=LicenseLimitationModel(enabled=True, limit=5, size=2),
        )
        get_license = mocker.patch(
            "controllers.console.feature.FeatureService.get_license",
            return_value=license_model,
        )

        api = SystemFeatureLicenseApi()
        raw_get = unwrap(SystemFeatureLicenseApi.get)
        result = raw_get(api)

        assert result == license_model.model_dump()
        assert result["seats"] == {"enabled": True, "limit": 5, "size": 2}
        get_license.assert_called_once_with()
