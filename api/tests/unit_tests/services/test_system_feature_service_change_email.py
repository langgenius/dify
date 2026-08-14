import pytest

from enums import DeploymentEdition
from services.system_feature_service import SystemFeatureService


@pytest.mark.parametrize("enabled", [False, True])
def test_get_system_features_reads_enable_change_email(
    monkeypatch: pytest.MonkeyPatch,
    enabled: bool,
) -> None:
    monkeypatch.setattr("services.system_feature_service.dify_config.ENABLE_CHANGE_EMAIL", enabled)

    result = SystemFeatureService.get_public_system_features()

    assert result.enable_change_email is enabled


@pytest.mark.parametrize(
    ("deployment_edition", "configured", "expected"),
    [
        (DeploymentEdition.COMMUNITY, False, False),
        (DeploymentEdition.COMMUNITY, True, True),
        (DeploymentEdition.ENTERPRISE, True, False),
    ],
)
def test_change_email_policy(
    monkeypatch: pytest.MonkeyPatch,
    deployment_edition: DeploymentEdition,
    configured: bool,
    expected: bool,
) -> None:
    monkeypatch.setattr("services.system_feature_service.dify_config.DEPLOYMENT_EDITION", deployment_edition)
    monkeypatch.setattr("services.system_feature_service.dify_config.ENABLE_CHANGE_EMAIL", configured)

    assert SystemFeatureService.is_change_email_enabled() is expected
