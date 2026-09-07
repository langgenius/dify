"""Tests for the public SystemFeatureService app DSL contract."""

from services.system_feature_service import SystemFeatureService


def test_get_system_features_excludes_app_dsl_version() -> None:
    result = SystemFeatureService.get_public_system_features().model_dump()

    assert "app_dsl_version" not in result
