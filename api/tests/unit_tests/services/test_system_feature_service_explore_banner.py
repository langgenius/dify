"""Tests for the SystemFeatureService explore-banner policy."""

from collections.abc import Callable

import pytest

from enums import DeploymentEdition
from services.system_feature_service import SystemFeatureService


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
    config_overrides: Callable[..., None],
    edition: DeploymentEdition,
    configured: bool,
    expected: bool,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=edition, ENABLE_EXPLORE_BANNER=configured)
    monkeypatch.setattr(SystemFeatureService, "_fulfill_params_from_enterprise", lambda *_: None)

    result = SystemFeatureService.get_public_system_features()

    assert SystemFeatureService.is_explore_banner_enabled() is expected
    assert result.enable_explore_banner is expected
