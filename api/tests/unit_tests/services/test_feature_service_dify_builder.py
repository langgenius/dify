import pytest

from services import feature_service as feature_service_module
from services.feature_service import FeatureService


def test_dify_builder_flag_follows_config_true(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(feature_service_module.dify_config, "DIFY_BUILDER_ENABLED", True)

    features = FeatureService.get_features("tenant-1")

    assert features.dify_builder_enabled is True


def test_dify_builder_flag_defaults_false(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(feature_service_module.dify_config, "DIFY_BUILDER_ENABLED", False)

    features = FeatureService.get_features("tenant-1")

    assert features.dify_builder_enabled is False


def test_feature_service_surfaces_skill_learning_policy(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(feature_service_module.dify_config, "DIFY_BUILDER_SKILL_LEARNING_POLICY", "automatic")

    features = FeatureService.get_features("tenant-1")

    assert features.skill_learning_policy == "automatic"


def test_skill_learning_policy_defaults_ask(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(feature_service_module.dify_config, "DIFY_BUILDER_SKILL_LEARNING_POLICY", "ask")

    features = FeatureService.get_features("tenant-1")

    assert features.skill_learning_policy == "ask"
