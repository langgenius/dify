from collections.abc import Callable
from unittest.mock import patch

import pytest

from enums import DeploymentEdition
from services.feature_service import FeatureService


@pytest.mark.parametrize(
    ("edition", "centrally_managed"),
    [
        (DeploymentEdition.COMMUNITY, False),
        (DeploymentEdition.CLOUD, False),
        (DeploymentEdition.ENTERPRISE, True),
    ],
)
def test_workspace_features_report_im_binding_management_mode(
    config_overrides: Callable[..., None], edition: DeploymentEdition, centrally_managed: bool
) -> None:
    config_overrides(DEPLOYMENT_EDITION=edition)
    with patch("services.feature_service.EnterpriseService.get_workspace_info", return_value={}):
        features = FeatureService.get_features("")

    assert features.model_dump()["im_binding_centrally_managed"] is centrally_managed
