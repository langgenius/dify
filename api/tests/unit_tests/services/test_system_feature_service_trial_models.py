"""Tests for the public SystemFeatureService hosted-model contract."""

from services.system_feature_service import SystemFeatureService


def test_get_system_features_excludes_trial_models() -> None:
    result = SystemFeatureService.get_public_system_features().model_dump()

    assert "trial_models" not in result
