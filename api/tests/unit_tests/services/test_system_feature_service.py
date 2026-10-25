import logging
from collections.abc import Callable
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from enums import DeploymentEdition
from services import system_feature_service as feature_service_module
from services.entities.feature_entities import (
    LicenseModel,
    LicenseStatus,
    PluginInstallationScope,
    SSOProtocol,
    SystemFeatureModel,
)
from services.system_feature_service import SystemFeatureService

"""Tests for the public SystemFeatureService app DSL contract."""


def test_get_system_features_excludes_app_dsl_version() -> None:
    result = SystemFeatureService.get_public_system_features().model_dump()

    assert "app_dsl_version" not in result


@pytest.mark.parametrize("enabled", [False, True])
def test_get_system_features_reads_enable_change_email(
    config_overrides: Callable[..., None],
    enabled: bool,
) -> None:
    config_overrides(ENABLE_CHANGE_EMAIL=enabled)

    result = SystemFeatureService.get_public_system_features()

    assert result.enable_change_email is enabled


@pytest.mark.parametrize(
    ("deployment_edition", "configured", "expected"),
    [
        (DeploymentEdition.COMMUNITY, False, False),
        (DeploymentEdition.COMMUNITY, True, True),
        (DeploymentEdition.ENTERPRISE, True, False),
    ],
)
def test_change_email_policy(
    config_overrides: Callable[..., None],
    deployment_edition: DeploymentEdition,
    configured: bool,
    expected: bool,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=deployment_edition, ENABLE_CHANGE_EMAIL=configured)

    assert SystemFeatureService.is_change_email_enabled() is expected


"""Tests for SystemFeatureService deployment-edition behavior."""


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


"""Tests for the SystemFeatureService app-deployment policy."""


@pytest.mark.parametrize(
    ("enterprise_info", "initial", "expected"),
    [
        # Enterprise reports the feature on -> mirrored through.
        ({"EnableAppDeploy": True}, False, True),
        # Enterprise may turn it off; the read runs after the hardcoded default
        # and overrides it (forward-compat with a future entitlement gate).
        ({"EnableAppDeploy": False}, True, False),
        # Old enterprise without the key -> the existing value is left untouched.
        ({}, True, True),
    ],
    ids=["enabled", "override_off", "missing_keeps_default"],
)
def test_fulfill_params_from_enterprise_enable_app_deploy(
    monkeypatch: pytest.MonkeyPatch,
    enterprise_info: dict[str, object],
    initial: bool,
    expected: bool,
) -> None:
    monkeypatch.setattr(
        feature_service_module.EnterpriseService,
        "get_info",
        staticmethod(lambda: enterprise_info),
    )

    features = SystemFeatureModel(
        agent_tracing_api_collection_enabled=False, deployment_edition=DeploymentEdition.COMMUNITY
    )
    features.enable_app_deploy = initial

    SystemFeatureService._fulfill_params_from_enterprise(features)

    assert features.enable_app_deploy is expected


"""Tests for the SystemFeatureService explore-banner policy."""


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


def test_workspace_creation_uses_environment_policy(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, ALLOW_CREATE_WORKSPACE=True)
    monkeypatch.setattr(
        "services.system_feature_service.EnterpriseService.get_info",
        lambda: (_ for _ in ()).throw(AssertionError("enterprise API should not be called")),
    )

    assert SystemFeatureService.is_workspace_creation_allowed() is True


def test_workspace_creation_uses_enterprise_policy(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(
        "services.system_feature_service.EnterpriseService.get_info",
        lambda: {"IsAllowCreateWorkspace": False},
    )

    assert SystemFeatureService.is_workspace_creation_allowed() is False


def test_workspace_creation_keeps_environment_policy_when_enterprise_value_is_missing(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE, ALLOW_CREATE_WORKSPACE=True)
    monkeypatch.setattr("services.system_feature_service.EnterpriseService.get_info", lambda: {})

    assert SystemFeatureService.is_workspace_creation_allowed() is True


def test_plugin_manager_is_enabled_only_for_enterprise(config_overrides: Callable[..., None]) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    assert SystemFeatureService.is_plugin_manager_enabled() is True

    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    assert SystemFeatureService.is_plugin_manager_enabled() is False


def test_webapp_auth_enabled_does_not_query_enterprise_info(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(
        "services.system_feature_service.EnterpriseService.get_info",
        lambda: (_ for _ in ()).throw(AssertionError("enterprise info should not be queried")),
    )

    assert SystemFeatureService.is_webapp_auth_enabled() is True


def test_registration_policy_uses_enterprise_override(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE, ALLOW_REGISTER=True)
    monkeypatch.setattr(
        "services.system_feature_service.EnterpriseService.get_info",
        lambda: {"IsAllowRegister": False},
    )

    assert SystemFeatureService.is_registration_allowed() is False


def test_password_login_policy_uses_enterprise_override(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE, ENABLE_EMAIL_PASSWORD_LOGIN=True)
    monkeypatch.setattr(
        "services.system_feature_service.EnterpriseService.get_info",
        lambda: {"EnableEmailPasswordLogin": False},
    )

    assert SystemFeatureService.is_email_password_login_enabled() is False


def test_branding_reads_enterprise_configuration(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(
        "services.system_feature_service.EnterpriseService.get_info",
        lambda: {
            "Branding": {
                "applicationTitle": "Enterprise Dify",
                "loginPageLogo": "login-logo",
                "workspaceLogo": "workspace-logo",
                "favicon": "favicon",
            }
        },
    )

    branding = SystemFeatureService.get_branding()

    assert branding.enabled is True
    assert branding.application_title == "Enterprise Dify"
    assert branding.login_page_logo == "login-logo"
    assert branding.workspace_logo == "workspace-logo"
    assert branding.favicon == "favicon"


def test_license_status_ignores_unrelated_malformed_quota_fields(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(
        "services.system_feature_service.EnterpriseService.get_info",
        lambda: {
            "License": {
                "status": "active",
                "workspaces": {"enabled": True, "limit": 3, "used": {"unexpected": "shape"}},
                "licensedSeats": "unexpected-shape",
            }
        },
    )

    assert SystemFeatureService.get_license_status() == LicenseStatus.ACTIVE


"""Tests for SystemFeatureService learn-app and tour policies."""


def test_system_feature_model_defaults_enable_learn_app() -> None:
    system_features = SystemFeatureModel(
        agent_tracing_api_collection_enabled=False, deployment_edition=DeploymentEdition.COMMUNITY
    )

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


"""Tests for the SystemFeatureService license-expiry policy."""


_SYSTEM_FEATURE_SERVICE_LICENSE_EXPIRY_NOTICE_ENTERPRISE_INFO = {
    "License": {"status": LicenseStatus.EXPIRING, "expiredAt": "2026-12-31"}
}


def test_license_model_defaults_license_expiry_notice_disabled() -> None:
    """Without a license there is no expiry to announce, so the notice is off unless enabled explicitly."""
    assert LicenseModel().license_expiry_notice_enabled is False


@pytest.mark.parametrize("enabled", [True, False])
def test_get_license_non_enterprise_ignores_expiry_notice_config(
    config_overrides: Callable[..., None], enabled: bool
) -> None:
    """Non-enterprise deployments have no license, so the env toggle never turns the notice on."""
    config_overrides(
        ENABLE_LICENSE_EXPIRY_NOTICE=enabled,
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
    )

    result = SystemFeatureService.get_license()

    assert result.license_expiry_notice_enabled is False


@pytest.mark.parametrize("enabled", [True, False])
def test_get_license_enterprise_reads_license_expiry_notice_enabled(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], enabled: bool
) -> None:
    """The enterprise-sourced license carries the env-resolved notice flag alongside its real status."""
    config_overrides(
        ENABLE_LICENSE_EXPIRY_NOTICE=enabled,
        DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE,
    )
    monkeypatch.setattr(
        feature_service_module.EnterpriseService,
        "get_info",
        staticmethod(lambda: _SYSTEM_FEATURE_SERVICE_LICENSE_EXPIRY_NOTICE_ENTERPRISE_INFO),
    )

    result = SystemFeatureService.get_license()

    assert result.status == LicenseStatus.EXPIRING
    assert result.expired_at == "2026-12-31"
    assert result.license_expiry_notice_enabled is enabled


"""Tests for SystemFeatureService licensed-seat parsing."""


_SYSTEM_FEATURE_SERVICE_LICENSED_SEATS_ENTERPRISE_INFO = {
    "License": {"licensedSeats": {"enabled": True, "limit": 3, "used": 1}}
}


def test_get_license_parses_licensed_seats(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    """The authenticated license accessor copies the licensed-seat quota out of the enterprise payload."""
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(
        feature_service_module.EnterpriseService,
        "get_info",
        staticmethod(lambda: _SYSTEM_FEATURE_SERVICE_LICENSED_SEATS_ENTERPRISE_INFO),
    )

    license_model = SystemFeatureService.get_license()

    assert isinstance(license_model, LicenseModel)
    assert license_model.seats.enabled is True
    assert license_model.seats.limit == 3
    assert license_model.seats.size == 1


def test_get_license_non_enterprise_is_unconstrained(config_overrides: Callable[..., None]) -> None:
    """Non-enterprise deployments have no license; seat allocation is unconstrained."""
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)

    license_model = SystemFeatureService.get_license()

    assert license_model.status == LicenseStatus.NONE
    assert license_model.seats.enabled is False
    assert license_model.seats.is_available() is True


"""Tests for SystemFeatureService plugin-installation policy."""


def test_get_plugin_installation_permission_defaults_to_all_for_non_enterprise(
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)

    permission = SystemFeatureService.get_plugin_installation_permission()

    assert permission.plugin_installation_scope is PluginInstallationScope.ALL
    assert permission.restrict_to_marketplace_only is False


def test_get_plugin_installation_permission_parses_enterprise_policy(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
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

    permission = SystemFeatureService.get_plugin_installation_permission()

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
    with caplog.at_level(logging.ERROR, logger="services.system_feature_service"):
        permission = SystemFeatureService._resolve_plugin_installation_permission(
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
    features = SystemFeatureModel(
        agent_tracing_api_collection_enabled=False, deployment_edition=DeploymentEdition.ENTERPRISE
    )

    SystemFeatureService._fulfill_params_from_enterprise(features)

    assert features.plugin_installation_permission.plugin_installation_scope is PluginInstallationScope.NONE
    assert features.plugin_installation_permission.restrict_to_marketplace_only is True


"""Tests for SystemFeatureService SSO protocol parsing."""


def test_system_features_exposes_valid_enterprise_sso_protocols(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        feature_service_module.EnterpriseService,
        "get_info",
        staticmethod(
            lambda: {
                "SSOEnforcedForSigninProtocol": "saml",
                "WebAppAuth": {},
                "SSOEnforcedForWebProtocol": "oidc",
            }
        ),
    )
    features = SystemFeatureModel(
        agent_tracing_api_collection_enabled=False, deployment_edition=DeploymentEdition.ENTERPRISE
    )

    SystemFeatureService._fulfill_params_from_enterprise(features)

    assert features.sso_enforced_for_signin_protocol is SSOProtocol.SAML
    assert features.webapp_auth.sso_config.protocol is SSOProtocol.OIDC


@pytest.mark.parametrize("empty_protocol", [None, "", "   "])
def test_system_features_normalizes_empty_enterprise_sso_protocols_to_none(
    monkeypatch: pytest.MonkeyPatch,
    empty_protocol: object,
) -> None:
    monkeypatch.setattr(
        feature_service_module.EnterpriseService,
        "get_info",
        staticmethod(
            lambda: {
                "SSOEnforcedForSigninProtocol": empty_protocol,
                "WebAppAuth": {},
                "SSOEnforcedForWebProtocol": empty_protocol,
            }
        ),
    )
    features = SystemFeatureModel(
        agent_tracing_api_collection_enabled=False, deployment_edition=DeploymentEdition.ENTERPRISE
    )

    SystemFeatureService._fulfill_params_from_enterprise(features)

    assert features.sso_enforced_for_signin_protocol is None
    assert features.webapp_auth.sso_config.protocol is None


@pytest.mark.parametrize("invalid_protocol", ["unknown", 42])
def test_system_features_rejects_invalid_enterprise_sso_protocols(
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
    invalid_protocol: object,
) -> None:
    monkeypatch.setattr(
        feature_service_module.EnterpriseService,
        "get_info",
        staticmethod(
            lambda: {
                "SSOEnforcedForSigninProtocol": invalid_protocol,
                "WebAppAuth": {},
                "SSOEnforcedForWebProtocol": invalid_protocol,
            }
        ),
    )
    features = SystemFeatureModel(
        agent_tracing_api_collection_enabled=False, deployment_edition=DeploymentEdition.ENTERPRISE
    )

    with caplog.at_level(logging.ERROR, logger="services.system_feature_service"):
        SystemFeatureService._fulfill_params_from_enterprise(features)

    assert features.sso_enforced_for_signin_protocol is None
    assert features.webapp_auth.sso_config.protocol is None
    assert caplog.text.count("Invalid Enterprise SSO protocol") == 2


def test_system_features_defaults_sso_protocols_to_none() -> None:
    features = SystemFeatureModel(
        agent_tracing_api_collection_enabled=False, deployment_edition=DeploymentEdition.COMMUNITY
    )

    assert features.sso_enforced_for_signin_protocol is None
    assert features.webapp_auth.sso_config.protocol is None


"""Tests for the public SystemFeatureService hosted-model contract."""


def test_get_system_features_excludes_trial_models() -> None:
    result = SystemFeatureService.get_public_system_features().model_dump()

    assert "trial_models" not in result


"""Tests for the SystemFeatureService WebApp public-access policy."""


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

    system_features = SystemFeatureModel(
        agent_tracing_api_collection_enabled=False, deployment_edition=DeploymentEdition.COMMUNITY
    )
    SystemFeatureService._fulfill_system_params_from_env(system_features)

    assert system_features.webapp_auth.allow_public_access is expected


def test_get_system_features_defaults_allow_public_access_to_true() -> None:
    system_features = SystemFeatureService.get_public_system_features()

    assert system_features.webapp_auth.allow_public_access is True
