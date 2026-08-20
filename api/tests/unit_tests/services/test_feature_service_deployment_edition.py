from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from enums import DeploymentEdition
from services.entities.feature_entities import SystemFeatureModel
from services.feature_service import FeatureService


def test_system_feature_model_requires_deployment_edition() -> None:
    with pytest.raises(ValidationError):
        SystemFeatureModel.model_validate({})


@pytest.mark.parametrize(
    "edition",
    [
        DeploymentEdition.COMMUNITY,
        DeploymentEdition.ENTERPRISE,
        DeploymentEdition.CLOUD,
    ],
)
def test_get_system_features_uses_configured_deployment_edition(
    monkeypatch: pytest.MonkeyPatch,
    edition: DeploymentEdition,
) -> None:
    fulfill_from_enterprise = MagicMock()
    monkeypatch.setattr("services.feature_service.dify_config.DEPLOYMENT_EDITION", edition)
    monkeypatch.setattr(
        "services.feature_service.FeatureService._fulfill_params_from_enterprise",
        fulfill_from_enterprise,
    )

    result = FeatureService.get_system_features()

    assert result.deployment_edition is edition
    assert result.model_dump(mode="json")["deployment_edition"] == edition.value
    webapp_auth_enabled = edition is DeploymentEdition.ENTERPRISE
    assert FeatureService.is_webapp_auth_enabled() is webapp_auth_enabled
    assert result.webapp_auth.enabled is webapp_auth_enabled
    if edition is DeploymentEdition.ENTERPRISE:
        fulfill_from_enterprise.assert_called_once_with(result)
    else:
        fulfill_from_enterprise.assert_not_called()
