from pytest_mock import MockerFixture
from werkzeug.exceptions import Unauthorized


class TestFeatureApi:
    def test_get_tenant_features_success(self, mocker: MockerFixture):
        mocker.patch(
            "controllers.console.feature.current_account_with_tenant",
            return_value=("account_id", "tenant_123"),
        )
        mocker.patch(
            "controllers.console.feature.FeatureService.get_features"
        ).return_value.model_dump.return_value = {"features": {"feature_a": True}}

        from controllers.console.feature import get_features

        result = get_features()

        assert result.model_dump() == {"features": {"feature_a": True}}


class TestSystemFeatureApi:
    def test_get_system_features_authenticated(self, mocker: MockerFixture):
        """
        current_user.is_authenticated == True
        """
        mocker.patch("controllers.console.feature.current_user.is_authenticated", True)
        mocker.patch(
            "controllers.console.feature.FeatureService.get_system_features"
        ).return_value = {"system_features": {"feature_b": True}}

        from controllers.console.feature import get_system_features

        result = get_system_features()

        assert result == {"system_features": {"feature_b": True}}

    def test_get_system_features_unauthenticated(self, mocker: MockerFixture):
        """
        Test that system features still work when current_user.is_authenticated raises Unauthorized
        """
        mocker.patch(
            "controllers.console.feature.current_user.is_authenticated",
            new_callable=mocker.PropertyMock,
            side_effect=Unauthorized(),
        )
        mocker.patch(
            "controllers.console.feature.FeatureService.get_system_features"
        ).return_value = {"system_features": {"feature_c": True}}

        from controllers.console.feature import get_system_features

        result = get_system_features()

        # Should call get_system_features with is_authenticated=False
        from services.feature_service import FeatureService

        FeatureService.get_system_features.assert_called_once_with(is_authenticated=False)
        assert result == {"system_features": {"feature_c": True}}
