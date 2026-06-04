from pytest_mock import MockerFixture
from werkzeug.exceptions import Unauthorized


def unwrap(func):
    """
    Recursively unwrap decorated functions.
    """
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestFeatureApi:
    def test_get_tenant_features_success(self, mocker: MockerFixture):
        from controllers.console.feature import FeatureApi

        get_features = mocker.patch("controllers.console.feature.FeatureService.get_features")
        get_features.return_value.model_dump.return_value = {
            "features": {"feature_a": True},
            "vector_space": {"size": 1, "limit": 2},
        }

        api = FeatureApi()

        raw_get = unwrap(FeatureApi.get)
        result = raw_get(api, "tenant_123")

        assert result == {"features": {"feature_a": True}}
        get_features.assert_called_once_with("tenant_123", exclude_vector_space=True)


class TestFeatureVectorSpaceApi:
    def test_get_vector_space_success(self, mocker: MockerFixture):
        from controllers.console.feature import FeatureVectorSpaceApi

        get_vector_space = mocker.patch("controllers.console.feature.FeatureService.get_vector_space")
        get_vector_space.return_value.model_dump.return_value = {"size": 5120, "limit": 20480}

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
    def test_get_system_features_authenticated(self, mocker: MockerFixture):
        """
        current_user.is_authenticated == True
        """

        from controllers.console.feature import SystemFeatureApi

        fake_user = mocker.Mock()
        fake_user.is_authenticated = True

        mocker.patch(
            "controllers.console.feature.current_user",
            fake_user,
        )

        mocker.patch(
            "controllers.console.feature.FeatureService.get_system_features"
        ).return_value.model_dump.return_value = {"features": {"sys_feature": True}}

        api = SystemFeatureApi()
        result = api.get()

        assert result == {"features": {"sys_feature": True}}

    def test_get_system_features_unauthenticated(self, mocker: MockerFixture):
        """
        current_user.is_authenticated raises Unauthorized
        """

        from controllers.console.feature import SystemFeatureApi

        fake_user = mocker.Mock()
        type(fake_user).is_authenticated = mocker.PropertyMock(side_effect=Unauthorized())

        mocker.patch(
            "controllers.console.feature.current_user",
            fake_user,
        )

        mocker.patch(
            "controllers.console.feature.FeatureService.get_system_features"
        ).return_value.model_dump.return_value = {"features": {"sys_feature": False}}

        api = SystemFeatureApi()
        result = api.get()

        assert result == {"features": {"sys_feature": False}}
