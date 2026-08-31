from collections.abc import Callable

from enums import DeploymentEdition
from services.entities.feature_entities import FeatureModel
from services.feature_service import FeatureService


def test_skill_feature_is_disabled_by_default() -> None:
    assert FeatureModel().enable_skill is True


def test_skill_feature_follows_env_config(config_overrides: Callable[..., None]) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, ENABLE_SKILL=True)

    features = FeatureService.get_features("")

    assert features.enable_skill is True
