from collections.abc import Callable
from unittest.mock import patch

import pytest

from enums import DeploymentEdition
from services.account_education_service import EDUCATION_EDITIONS
from services.entities.feature_entities import FeatureModel
from services.feature_service import FeatureService


def test_education_feature_is_disabled_by_default() -> None:
    assert FeatureModel().education.enabled is False


@pytest.mark.parametrize("edition", list(DeploymentEdition))
def test_education_is_advertised_only_where_its_endpoints_exist(
    config_overrides: Callable[..., None], edition: DeploymentEdition
) -> None:
    """The frontend gates its /account/education* calls on this flag, and the admission
    decorator answers 404 on every edition outside EDUCATION_EDITIONS."""
    config_overrides(DEPLOYMENT_EDITION=edition, EDUCATION_ENABLED=True)

    with patch("services.feature_service.EnterpriseService.get_workspace_info", return_value={}):
        features = FeatureService.get_features("")

    assert features.education.enabled is (edition in EDUCATION_EDITIONS)


def test_education_stays_disabled_on_cloud_without_the_env_flag(
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, EDUCATION_ENABLED=False)

    features = FeatureService.get_features("")

    assert features.education.enabled is False
