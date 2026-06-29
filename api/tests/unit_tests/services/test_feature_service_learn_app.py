import pytest

from services import feature_service as feature_service_module
from services.feature_service import FeatureService, SystemFeatureModel


def test_system_feature_model_defaults_enable_learn_app():
    assert SystemFeatureModel().enable_learn_app is True
    assert SystemFeatureModel().enable_step_by_step_tour is False


@pytest.mark.parametrize("enabled", [True, False])
def test_get_system_features_reads_enable_learn_app(monkeypatch: pytest.MonkeyPatch, enabled: bool):
    monkeypatch.setattr(feature_service_module.dify_config, "ENABLE_LEARN_APP", enabled)

    result = FeatureService.get_system_features()

    assert result.enable_learn_app is enabled


@pytest.mark.parametrize("enabled", [True, False])
def test_get_system_features_reads_enable_step_by_step_tour(
    monkeypatch: pytest.MonkeyPatch, enabled: bool
) -> None:
    monkeypatch.setattr(feature_service_module.dify_config, "ENABLE_STEP_BY_STEP_TOUR", enabled)

    result = FeatureService.get_system_features()

    assert result.enable_step_by_step_tour is enabled
