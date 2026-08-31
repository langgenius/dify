from collections.abc import Callable

import pytest

from enums import DeploymentEdition
from services.feature_service import FeatureService


def test_workspace_creation_uses_environment_policy(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, ALLOW_CREATE_WORKSPACE=True)
    monkeypatch.setattr(
        "services.feature_service.EnterpriseService.get_info",
        lambda: (_ for _ in ()).throw(AssertionError("enterprise API should not be called")),
    )

    assert FeatureService.is_workspace_creation_allowed() is True


def test_workspace_creation_uses_enterprise_policy(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(
        "services.feature_service.EnterpriseService.get_info",
        lambda: {"IsAllowCreateWorkspace": False},
    )

    assert FeatureService.is_workspace_creation_allowed() is False


def test_workspace_creation_keeps_environment_policy_when_enterprise_value_is_missing(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE, ALLOW_CREATE_WORKSPACE=True)
    monkeypatch.setattr("services.feature_service.EnterpriseService.get_info", lambda: {})

    assert FeatureService.is_workspace_creation_allowed() is True


def test_plugin_manager_is_enabled_only_for_enterprise(config_overrides: Callable[..., None]) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    assert FeatureService.is_plugin_manager_enabled() is True

    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    assert FeatureService.is_plugin_manager_enabled() is False
