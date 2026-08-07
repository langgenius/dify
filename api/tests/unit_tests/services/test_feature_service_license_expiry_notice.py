import pytest

from enums.deployment_edition import DeploymentEdition
from services import feature_service as feature_service_module
from services.entities.feature_entities import SystemFeatureModel
from services.feature_service import FeatureService


def test_system_feature_model_defaults_enable_license_expiry_notice() -> None:
    system_features = SystemFeatureModel(deployment_edition=DeploymentEdition.COMMUNITY)

    assert system_features.enable_license_expiry_notice is True


@pytest.mark.parametrize("enabled", [True, False])
def test_get_system_features_reads_enable_license_expiry_notice(monkeypatch: pytest.MonkeyPatch, enabled: bool) -> None:
    monkeypatch.setattr(feature_service_module.dify_config, "ENABLE_LICENSE_EXPIRY_NOTICE", enabled)

    result = FeatureService.get_system_features()

    assert result.enable_license_expiry_notice is enabled
