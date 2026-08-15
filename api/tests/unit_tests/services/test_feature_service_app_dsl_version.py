from services.feature_service import FeatureService


def test_get_system_features_excludes_app_dsl_version():
    result = FeatureService.get_system_features().model_dump()

    assert "app_dsl_version" not in result
