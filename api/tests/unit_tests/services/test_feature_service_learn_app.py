import pytest

from services import feature_service as feature_service_module
from services.feature_service import FeatureService, SystemFeatureModel


def test_system_feature_model_defaults_enable_learn_app():
    assert SystemFeatureModel().enable_learn_app is True


@pytest.mark.parametrize("enabled", [True, False])
def test_get_system_features_reads_enable_learn_app(monkeypatch: pytest.MonkeyPatch, enabled: bool):
    monkeypatch.setattr(feature_service_module.dify_config, "ENABLE_LEARN_APP", enabled)

    result = FeatureService.get_system_features()

    assert result.enable_learn_app is enabled
