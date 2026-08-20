"""Tests for the SystemFeatureService WebApp public-access policy."""

from collections.abc import Callable

import pytest

from enums import DeploymentEdition
from services.entities.feature_entities import SystemFeatureModel
from services.system_feature_service import SystemFeatureService


@pytest.mark.parametrize(
    ("env_value", "expected"),
    [
        (False, False),
        (True, True),
    ],
    ids=["disabled_by_env", "enabled_by_env"],
)
def test_fulfill_system_params_from_env_sets_allow_public_access(
    config_overrides: Callable[..., None],
    env_value: bool,
    expected: bool,
) -> None:
    config_overrides(WEBAPP_PUBLIC_ACCESS_ENABLED=env_value)

    system_features = SystemFeatureModel(deployment_edition=DeploymentEdition.COMMUNITY)
    SystemFeatureService._fulfill_system_params_from_env(system_features)

    assert system_features.webapp_auth.allow_public_access is expected


def test_get_system_features_defaults_allow_public_access_to_true() -> None:
    system_features = SystemFeatureService.get_public_system_features()

    assert system_features.webapp_auth.allow_public_access is True
