from constants.dsl_version import CURRENT_APP_DSL_VERSION
from services.feature_service import FeatureService


def test_get_system_features_excludes_app_dsl_version():
    result = FeatureService.get_system_features().model_dump()

    assert "app_dsl_version" not in result


def test_get_app_dsl_version_returns_current_version():
    result = FeatureService.get_app_dsl_version()

    assert result == CURRENT_APP_DSL_VERSION
