from collections.abc import Callable

import pytest

from enums import DeploymentEdition
from services.system_feature_service import SystemFeatureService


@pytest.mark.parametrize("enabled", [False, True])
def test_get_system_features_reads_enable_change_email(
    config_overrides: Callable[..., None],
    enabled: bool,
) -> None:
    config_overrides(ENABLE_CHANGE_EMAIL=enabled)

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
    config_overrides: Callable[..., None],
    deployment_edition: DeploymentEdition,
    configured: bool,
    expected: bool,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=deployment_edition, ENABLE_CHANGE_EMAIL=configured)

    assert SystemFeatureService.is_change_email_enabled() is expected
