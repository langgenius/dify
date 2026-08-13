import logging

import pytest

from enums import DeploymentEdition
from services import feature_service as feature_service_module
from services.entities.feature_entities import PluginInstallationScope, SystemFeatureModel
from services.feature_service import FeatureService


def test_get_plugin_installation_permission_defaults_to_all_for_non_enterprise(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(feature_service_module.dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)

    permission = FeatureService.get_plugin_installation_permission()

    assert permission.plugin_installation_scope is PluginInstallationScope.ALL
    assert permission.restrict_to_marketplace_only is False


def test_get_plugin_installation_permission_parses_enterprise_policy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(feature_service_module.dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(
        feature_service_module.EnterpriseService,
        "get_info",
        staticmethod(
            lambda: {
                "PluginInstallationPermission": {
                    "pluginInstallationScope": "official_only",
                    "restrictToMarketplaceOnly": True,
                }
            }
        ),
    )

    permission = FeatureService.get_plugin_installation_permission()

    assert permission.plugin_installation_scope is PluginInstallationScope.OFFICIAL_ONLY
    assert permission.restrict_to_marketplace_only is True


@pytest.mark.parametrize(
    "invalid_permission",
    [
        {
            "pluginInstallationScope": "unknown-scope",
            "restrictToMarketplaceOnly": False,
        },
        {
            "pluginInstallationScope": "all",
            "restrictToMarketplaceOnly": "false",
        },
    ],
    ids=["unknown_scope", "non_boolean_marketplace_restriction"],
)
def test_invalid_enterprise_policy_denies_all_plugin_installations(
    caplog: pytest.LogCaptureFixture,
    invalid_permission: dict[str, object],
) -> None:
    with caplog.at_level(logging.ERROR, logger="services.feature_service"):
        permission = FeatureService._resolve_plugin_installation_permission(
            {"PluginInstallationPermission": invalid_permission}
        )

    assert permission.plugin_installation_scope is PluginInstallationScope.NONE
    assert permission.restrict_to_marketplace_only is True
    assert "denying all plugin installations" in caplog.text


def test_system_features_exposes_only_validated_plugin_installation_policy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        feature_service_module.EnterpriseService,
        "get_info",
        staticmethod(
            lambda: {
                "PluginInstallationPermission": {
                    "pluginInstallationScope": "unknown-scope",
                    "restrictToMarketplaceOnly": False,
                }
            }
        ),
    )
    features = SystemFeatureModel(deployment_edition=DeploymentEdition.ENTERPRISE)

    FeatureService._fulfill_params_from_enterprise(features)

    assert features.plugin_installation_permission.plugin_installation_scope is PluginInstallationScope.NONE
    assert features.plugin_installation_permission.restrict_to_marketplace_only is True
