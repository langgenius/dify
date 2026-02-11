from werkzeug.exceptions import Unauthorized


def unwrap(func):
    """
    Recursively unwrap decorated functions.
    """
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestFeatureApi:
    def test_get_tenant_features_success(self, mocker):
        from controllers.console.feature import FeatureApi

        mocker.patch(
            "controllers.console.feature.current_account_with_tenant",
            return_value=("account_id", "tenant_123"),
        )

        mocker.patch("controllers.console.feature.FeatureService.get_features").return_value.model_dump.return_value = {
            "features": {"feature_a": True}
        }

        api = FeatureApi()

        raw_get = unwrap(FeatureApi.get)
        result = raw_get(api)

        assert result == {"features": {"feature_a": True}}


class TestSystemFeatureApi:
    def test_get_system_features_authenticated(self, mocker):
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

    def test_get_system_features_unauthenticated(self, mocker):
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
