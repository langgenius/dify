"""Tests for SystemFeatureService learn-app and tour policies."""

from collections.abc import Callable

import pytest

from enums import DeploymentEdition
from services.entities.feature_entities import SystemFeatureModel
from services.system_feature_service import SystemFeatureService


def test_system_feature_model_defaults_enable_learn_app() -> None:
    system_features = SystemFeatureModel(deployment_edition=DeploymentEdition.COMMUNITY)
    assert system_features.enable_learn_app is True
    assert system_features.enable_step_by_step_tour is False


@pytest.mark.parametrize("enabled", [True, False])
def test_get_system_features_reads_enable_learn_app(config_overrides: Callable[..., None], enabled: bool) -> None:
    config_overrides(ENABLE_LEARN_APP=enabled)

    result = SystemFeatureService.get_public_system_features()

    assert result.enable_learn_app is enabled


@pytest.mark.parametrize("enabled", [True, False])
def test_get_system_features_reads_enable_step_by_step_tour(
    config_overrides: Callable[..., None], enabled: bool
) -> None:
    config_overrides(ENABLE_STEP_BY_STEP_TOUR=enabled)

    result = SystemFeatureService.get_public_system_features()

    assert result.enable_step_by_step_tour is enabled
