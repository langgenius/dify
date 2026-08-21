import pytest

from enums import DeploymentEdition
from services.entities.feature_entities import LicenseStatus
from services.system_feature_service import SystemFeatureService


def test_workspace_creation_uses_environment_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.system_feature_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    monkeypatch.setattr("services.system_feature_service.dify_config.ALLOW_CREATE_WORKSPACE", True)
    monkeypatch.setattr(
        "services.system_feature_service.EnterpriseService.get_info",
        lambda: (_ for _ in ()).throw(AssertionError("enterprise API should not be called")),
    )

    assert SystemFeatureService.is_workspace_creation_allowed() is True


def test_workspace_creation_uses_enterprise_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.system_feature_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(
        "services.system_feature_service.EnterpriseService.get_info",
        lambda: {"IsAllowCreateWorkspace": False},
    )

    assert SystemFeatureService.is_workspace_creation_allowed() is False


def test_workspace_creation_keeps_environment_policy_when_enterprise_value_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("services.system_feature_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr("services.system_feature_service.dify_config.ALLOW_CREATE_WORKSPACE", True)
    monkeypatch.setattr("services.system_feature_service.EnterpriseService.get_info", lambda: {})

    assert SystemFeatureService.is_workspace_creation_allowed() is True


def test_plugin_manager_is_enabled_only_for_enterprise(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.system_feature_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE)
    assert SystemFeatureService.is_plugin_manager_enabled() is True

    monkeypatch.setattr("services.system_feature_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    assert SystemFeatureService.is_plugin_manager_enabled() is False


def test_webapp_auth_enabled_does_not_query_enterprise_info(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.system_feature_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(
        "services.system_feature_service.EnterpriseService.get_info",
        lambda: (_ for _ in ()).throw(AssertionError("enterprise info should not be queried")),
    )

    assert SystemFeatureService.is_webapp_auth_enabled() is True


def test_registration_policy_uses_enterprise_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.system_feature_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr("services.system_feature_service.dify_config.ALLOW_REGISTER", True)
    monkeypatch.setattr(
        "services.system_feature_service.EnterpriseService.get_info",
        lambda: {"IsAllowRegister": False},
    )

    assert SystemFeatureService.is_registration_allowed() is False


def test_password_login_policy_uses_enterprise_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.system_feature_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr("services.system_feature_service.dify_config.ENABLE_EMAIL_PASSWORD_LOGIN", True)
    monkeypatch.setattr(
        "services.system_feature_service.EnterpriseService.get_info",
        lambda: {"EnableEmailPasswordLogin": False},
    )

    assert SystemFeatureService.is_email_password_login_enabled() is False


def test_branding_reads_enterprise_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.system_feature_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE)
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


def test_license_status_ignores_unrelated_malformed_quota_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.system_feature_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE)
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
