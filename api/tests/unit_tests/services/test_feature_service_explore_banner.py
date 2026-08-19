import pytest

from enums import DeploymentEdition
from services import feature_service as feature_service_module
from services.feature_service import FeatureService


@pytest.mark.parametrize(
    ("edition", "configured", "expected"),
    [
        (DeploymentEdition.CLOUD, True, True),
        (DeploymentEdition.CLOUD, False, False),
        (DeploymentEdition.COMMUNITY, True, False),
        (DeploymentEdition.ENTERPRISE, True, False),
    ],
)
def test_get_system_features_enables_explore_banner_only_for_cloud(
    monkeypatch: pytest.MonkeyPatch,
    edition: DeploymentEdition,
    configured: bool,
    expected: bool,
) -> None:
    monkeypatch.setattr(feature_service_module.dify_config, "DEPLOYMENT_EDITION", edition)
    monkeypatch.setattr(feature_service_module.dify_config, "ENABLE_EXPLORE_BANNER", configured)
    monkeypatch.setattr(FeatureService, "_fulfill_params_from_enterprise", lambda *_: None)

    result = FeatureService.get_system_features()

    assert FeatureService.is_explore_banner_enabled() is expected
    assert result.enable_explore_banner is expected
