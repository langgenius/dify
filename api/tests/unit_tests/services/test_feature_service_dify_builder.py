import pytest

from services.feature_service import FeatureService
from tests.unit_tests.config_override import apply_config_overrides


def test_dify_builder_flag_follows_config_true(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, DIFY_BUILDER_ENABLED=True)

    features = FeatureService.get_features("tenant-1")

    assert features.dify_builder_enabled is True


def test_dify_builder_flag_defaults_false(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, DIFY_BUILDER_ENABLED=False)

    features = FeatureService.get_features("tenant-1")

    assert features.dify_builder_enabled is False


def test_feature_service_surfaces_skill_learning_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, DIFY_BUILDER_SKILL_LEARNING_POLICY="automatic")

    features = FeatureService.get_features("tenant-1")

    assert features.skill_learning_policy == "automatic"


def test_skill_learning_policy_defaults_ask(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, DIFY_BUILDER_SKILL_LEARNING_POLICY="ask")

    features = FeatureService.get_features("tenant-1")

    assert features.skill_learning_policy == "ask"
