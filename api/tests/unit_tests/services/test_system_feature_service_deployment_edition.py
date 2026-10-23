"""Tests for SystemFeatureService deployment-edition behavior."""

from collections.abc import Callable
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from enums import DeploymentEdition
from services.entities.feature_entities import SystemFeatureModel
from services.system_feature_service import SystemFeatureService


def test_system_feature_model_requires_deployment_edition() -> None:
    with pytest.raises(ValidationError):
        SystemFeatureModel.model_validate({"agent_tracing_api_collection_enabled": False})


@pytest.mark.parametrize("edition", list(DeploymentEdition))
@pytest.mark.parametrize("enabled", [False, True])
def test_public_agent_tracing_gate_uses_configured_value_in_every_edition(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    edition: DeploymentEdition,
    enabled: bool,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=edition, OPS_AGENT_TRACE_ENABLED=enabled)
    monkeypatch.setattr(
        "services.system_feature_service.EnterpriseService.get_info",
        staticmethod(lambda: {}),
    )

    result = SystemFeatureService.get_public_system_features()

    assert result.agent_tracing_api_collection_enabled is enabled
    assert result.model_dump(mode="json")["agent_tracing_api_collection_enabled"] is enabled


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
    config_overrides: Callable[..., None],
    edition: DeploymentEdition,
) -> None:
    fulfill_from_enterprise = MagicMock()
    config_overrides(DEPLOYMENT_EDITION=edition)
    monkeypatch.setattr(
        "services.system_feature_service.SystemFeatureService._fulfill_params_from_enterprise",
        fulfill_from_enterprise,
    )

    result = SystemFeatureService.get_public_system_features()

    assert result.deployment_edition is edition
    assert result.model_dump(mode="json")["deployment_edition"] == edition.value
    webapp_auth_enabled = edition is DeploymentEdition.ENTERPRISE
    assert SystemFeatureService.is_webapp_auth_enabled() is webapp_auth_enabled
    assert result.webapp_auth.enabled is webapp_auth_enabled
    if edition is DeploymentEdition.ENTERPRISE:
        fulfill_from_enterprise.assert_called_once_with(result)
    else:
        fulfill_from_enterprise.assert_not_called()


@pytest.mark.parametrize(
    ("edition", "expected"),
    [
        (DeploymentEdition.COMMUNITY, False),
        (DeploymentEdition.ENTERPRISE, True),
        (DeploymentEdition.CLOUD, True),
    ],
)
def test_evaluation_policy_is_limited_to_enterprise_and_cloud(
    edition: DeploymentEdition,
    expected: bool,
) -> None:
    assert SystemFeatureService.is_evaluation_enabled(deployment_edition=edition) is expected


@pytest.mark.parametrize(
    ("edition", "feature_enabled", "expected"),
    [
        (DeploymentEdition.CLOUD, True, True),
        (DeploymentEdition.CLOUD, False, False),
        (DeploymentEdition.COMMUNITY, True, False),
        (DeploymentEdition.ENTERPRISE, True, False),
    ],
)
def test_trial_app_policy_is_cloud_only(
    config_overrides: Callable[..., None],
    edition: DeploymentEdition,
    feature_enabled: bool,
    expected: bool,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=edition, ENABLE_TRIAL_APP=feature_enabled)

    assert SystemFeatureService.is_trial_app_enabled() is expected
