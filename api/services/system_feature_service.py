"""Deployment-wide feature policies and the public system-features snapshot."""

import logging
from collections.abc import Mapping

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from configs import dify_config
from enums import DeploymentEdition, HostedTrialProvider
from services.enterprise.enterprise_service import EnterpriseService
from services.entities import feature_entities

logger = logging.getLogger(__name__)


class _EnterprisePluginInstallationPermission(BaseModel):
    model_config = ConfigDict(extra="ignore")

    plugin_installation_scope: feature_entities.PluginInstallationScope = Field(alias="pluginInstallationScope")
    restrict_to_marketplace_only: bool = Field(alias="restrictToMarketplaceOnly", strict=True)


class SystemFeatureService:
    """Resolve deployment-wide policies without exposing the public response DTO internally."""

    @classmethod
    def get_public_system_features(cls) -> feature_entities.SystemFeatureModel:
        """Build the non-sensitive bootstrap snapshot shared by Console and Web."""
        system_features = feature_entities.SystemFeatureModel(deployment_edition=dify_config.DEPLOYMENT_EDITION)
        system_features.rbac_enabled = dify_config.RBAC_ENABLED

        cls._fulfill_system_params_from_env(system_features)

        if cls.is_webapp_auth_enabled():
            system_features.branding.enabled = True
            system_features.webapp_auth.enabled = True
            system_features.enable_change_email = False
            cls._fulfill_params_from_enterprise(system_features)

        if dify_config.MARKETPLACE_ENABLED:
            system_features.enable_marketplace = True

        if dify_config.CREATORS_PLATFORM_FEATURES_ENABLED:
            system_features.enable_creators_platform = True

        return system_features

    @classmethod
    def is_registration_allowed(cls) -> bool:
        """Return the effective registration policy, including the Enterprise override."""
        is_allowed = dify_config.ALLOW_REGISTER
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
            return is_allowed

        enterprise_info = EnterpriseService.get_info()
        return bool(enterprise_info.get("IsAllowRegister", is_allowed))

    @classmethod
    def is_email_password_login_enabled(cls) -> bool:
        """Return the effective password-login policy, including the Enterprise override."""
        is_enabled = dify_config.ENABLE_EMAIL_PASSWORD_LOGIN
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
            return is_enabled

        enterprise_info = EnterpriseService.get_info()
        return bool(enterprise_info.get("EnableEmailPasswordLogin", is_enabled))

    @staticmethod
    def is_change_email_enabled() -> bool:
        """Return whether Console accounts may change their email address."""
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.ENTERPRISE:
            return False
        return dify_config.ENABLE_CHANGE_EMAIL

    @staticmethod
    def is_webapp_auth_enabled(*, deployment_edition: DeploymentEdition | None = None) -> bool:
        """Return whether deployment-level WebApp authentication integration is enabled."""
        edition = deployment_edition if deployment_edition is not None else dify_config.DEPLOYMENT_EDITION
        return edition == DeploymentEdition.ENTERPRISE

    @classmethod
    def get_license_status(cls) -> feature_entities.LicenseStatus:
        """Return the deployment license status used by internal admission policies."""
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
            return feature_entities.LicenseStatus.NONE
        return cls._resolve_license_status(EnterpriseService.get_info())

    @classmethod
    def get_branding(cls) -> feature_entities.BrandingModel:
        """Return the deployment branding used by server-rendered email."""
        branding = feature_entities.BrandingModel(enabled=cls.is_webapp_auth_enabled())
        if not branding.enabled:
            return branding

        enterprise_info = EnterpriseService.get_info()
        if branding_info := enterprise_info.get("Branding"):
            branding.application_title = branding_info.get("applicationTitle", "")
            branding.login_page_logo = branding_info.get("loginPageLogo", "")
            branding.workspace_logo = branding_info.get("workspaceLogo", "")
            branding.favicon = branding_info.get("favicon", "")
        return branding

    @classmethod
    def is_workspace_creation_allowed(cls) -> bool:
        """Resolve the backend workspace-creation policy, including the Enterprise override."""
        is_allowed = dify_config.ALLOW_CREATE_WORKSPACE
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
            return is_allowed

        enterprise_info = EnterpriseService.get_info()
        return bool(enterprise_info.get("IsAllowCreateWorkspace", is_allowed))

    @staticmethod
    def is_plugin_manager_enabled() -> bool:
        """Return whether Enterprise plugin credential policies must be enforced."""
        return dify_config.DEPLOYMENT_EDITION == DeploymentEdition.ENTERPRISE

    @classmethod
    def get_plugin_installation_permission(cls) -> feature_entities.PluginInstallationPermissionModel:
        """Resolve the validated deployment-wide plugin installation policy."""
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
            return feature_entities.PluginInstallationPermissionModel()

        return cls._resolve_plugin_installation_permission(EnterpriseService.get_info())

    @classmethod
    def get_license(cls) -> feature_entities.LicenseModel:
        """Return full license detail for authenticated server-side consumers."""
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
            return feature_entities.LicenseModel()
        license_model = cls._build_license(EnterpriseService.get_info())
        license_model.license_expiry_notice_enabled = dify_config.ENABLE_LICENSE_EXPIRY_NOTICE
        return license_model

    @staticmethod
    def is_explore_banner_enabled() -> bool:
        return dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and dify_config.ENABLE_EXPLORE_BANNER

    @staticmethod
    def get_trial_models() -> list[str]:
        """Return hosted trial provider ids without building the public snapshot."""
        provider_enablement = {
            HostedTrialProvider.OPENAI: (
                dify_config.HOSTED_OPENAI_PAID_ENABLED,
                dify_config.HOSTED_OPENAI_TRIAL_ENABLED,
            ),
            HostedTrialProvider.ANTHROPIC: (
                dify_config.HOSTED_ANTHROPIC_PAID_ENABLED,
                dify_config.HOSTED_ANTHROPIC_TRIAL_ENABLED,
            ),
            HostedTrialProvider.GEMINI: (
                dify_config.HOSTED_GEMINI_PAID_ENABLED,
                dify_config.HOSTED_GEMINI_TRIAL_ENABLED,
            ),
            HostedTrialProvider.X: (
                dify_config.HOSTED_XAI_PAID_ENABLED,
                dify_config.HOSTED_XAI_TRIAL_ENABLED,
            ),
            HostedTrialProvider.DEEPSEEK: (
                dify_config.HOSTED_DEEPSEEK_PAID_ENABLED,
                dify_config.HOSTED_DEEPSEEK_TRIAL_ENABLED,
            ),
            HostedTrialProvider.TONGYI: (
                dify_config.HOSTED_TONGYI_PAID_ENABLED,
                dify_config.HOSTED_TONGYI_TRIAL_ENABLED,
            ),
        }
        return [
            provider.value
            for provider, (paid_enabled, trial_enabled) in provider_enablement.items()
            if paid_enabled and trial_enabled
        ]

    @classmethod
    def _fulfill_system_params_from_env(cls, system_features: feature_entities.SystemFeatureModel) -> None:
        system_features.enable_email_code_login = dify_config.ENABLE_EMAIL_CODE_LOGIN
        system_features.enable_email_password_login = dify_config.ENABLE_EMAIL_PASSWORD_LOGIN
        system_features.enable_social_oauth_login = dify_config.ENABLE_SOCIAL_OAUTH_LOGIN
        system_features.enable_collaboration_mode = dify_config.ENABLE_COLLABORATION_MODE
        system_features.is_allow_register = dify_config.ALLOW_REGISTER
        system_features.is_email_setup = dify_config.MAIL_TYPE is not None and dify_config.MAIL_TYPE != ""
        system_features.enable_change_email = dify_config.ENABLE_CHANGE_EMAIL
        system_features.enable_explore_banner = cls.is_explore_banner_enabled()
        system_features.enable_learn_app = dify_config.ENABLE_LEARN_APP
        system_features.webapp_auth.allow_public_access = dify_config.WEBAPP_PUBLIC_ACCESS_ENABLED
        system_features.enable_step_by_step_tour = dify_config.ENABLE_STEP_BY_STEP_TOUR
        system_features.knowledge_fs_enabled = dify_config.KNOWLEDGE_FS_ENABLED

    @classmethod
    def _fulfill_params_from_enterprise(cls, features: feature_entities.SystemFeatureModel) -> None:
        enterprise_info = EnterpriseService.get_info()

        if "SSOEnforcedForSignin" in enterprise_info:
            features.sso_enforced_for_signin = enterprise_info["SSOEnforcedForSignin"]

        features.sso_enforced_for_signin_protocol = cls._resolve_sso_protocol(
            enterprise_info.get("SSOEnforcedForSigninProtocol"),
            field_name="SSOEnforcedForSigninProtocol",
        )

        if "EnableEmailCodeLogin" in enterprise_info:
            features.enable_email_code_login = enterprise_info["EnableEmailCodeLogin"]

        if "EnableEmailPasswordLogin" in enterprise_info:
            features.enable_email_password_login = enterprise_info["EnableEmailPasswordLogin"]

        if "IsAllowRegister" in enterprise_info:
            features.is_allow_register = enterprise_info["IsAllowRegister"]

        if "EnableAppDeploy" in enterprise_info:
            features.enable_app_deploy = enterprise_info["EnableAppDeploy"]

        if "Branding" in enterprise_info:
            features.branding.application_title = enterprise_info["Branding"].get("applicationTitle", "")
            features.branding.login_page_logo = enterprise_info["Branding"].get("loginPageLogo", "")
            features.branding.workspace_logo = enterprise_info["Branding"].get("workspaceLogo", "")
            features.branding.favicon = enterprise_info["Branding"].get("favicon", "")

        if "WebAppAuth" in enterprise_info:
            features.webapp_auth.allow_sso = enterprise_info["WebAppAuth"].get("allowSso", False)
            features.webapp_auth.allow_email_code_login = enterprise_info["WebAppAuth"].get(
                "allowEmailCodeLogin", False
            )
            features.webapp_auth.allow_email_password_login = enterprise_info["WebAppAuth"].get(
                "allowEmailPasswordLogin", False
            )
            features.webapp_auth.sso_config.protocol = cls._resolve_sso_protocol(
                enterprise_info.get("SSOEnforcedForWebProtocol"),
                field_name="SSOEnforcedForWebProtocol",
            )

        # The unauthenticated endpoint exposes status only. Full license detail is
        # served by the authenticated license endpoint.
        license_status = cls._resolve_license_status(enterprise_info)
        if license_status != feature_entities.LicenseStatus.NONE:
            features.license = feature_entities.LicenseStatusModel(
                status=license_status,
            )

        features.plugin_installation_permission = cls._resolve_plugin_installation_permission(enterprise_info)

    @staticmethod
    def _resolve_license_status(enterprise_info: Mapping[str, object]) -> feature_entities.LicenseStatus:
        license_info = enterprise_info.get("License")
        if not license_info:
            return feature_entities.LicenseStatus.NONE
        if not isinstance(license_info, Mapping):
            return feature_entities.LicenseStatus.INACTIVE

        status = license_info.get("status", feature_entities.LicenseStatus.INACTIVE)
        if isinstance(status, feature_entities.LicenseStatus):
            return status
        if isinstance(status, str):
            return feature_entities.LicenseStatus(status)
        return feature_entities.LicenseStatus.INACTIVE

    @classmethod
    def _build_license(cls, enterprise_info: dict) -> feature_entities.LicenseModel:
        license_model = feature_entities.LicenseModel()
        if license_info := enterprise_info.get("License"):
            license_model.status = feature_entities.LicenseStatus(
                license_info.get("status", feature_entities.LicenseStatus.INACTIVE)
            )
            license_model.expired_at = license_info.get("expiredAt", "")
            if workspaces_info := license_info.get("workspaces"):
                license_model.workspaces = feature_entities.LicenseLimitationModel(
                    enabled=workspaces_info.get("enabled", False),
                    limit=workspaces_info.get("limit", 0),
                    size=workspaces_info.get("used", 0),
                )
            if seats_info := license_info.get("licensedSeats"):
                license_model.seats = feature_entities.LicenseLimitationModel(
                    enabled=seats_info.get("enabled", False),
                    limit=seats_info.get("limit", 0),
                    size=seats_info.get("used", 0),
                )
        return license_model

    @classmethod
    def _resolve_plugin_installation_permission(
        cls, enterprise_info: Mapping[str, object]
    ) -> feature_entities.PluginInstallationPermissionModel:
        if "PluginInstallationPermission" not in enterprise_info:
            return feature_entities.PluginInstallationPermissionModel()

        try:
            permission = _EnterprisePluginInstallationPermission.model_validate(
                enterprise_info["PluginInstallationPermission"]
            )
        except ValidationError as exc:
            logger.error(  # noqa: TRY400
                "Invalid Enterprise plugin installation permission; denying all plugin installations: %s",
                exc.errors(include_input=False),
            )
            return feature_entities.PluginInstallationPermissionModel(
                plugin_installation_scope=feature_entities.PluginInstallationScope.NONE,
                restrict_to_marketplace_only=True,
            )

        return feature_entities.PluginInstallationPermissionModel(
            plugin_installation_scope=permission.plugin_installation_scope,
            restrict_to_marketplace_only=permission.restrict_to_marketplace_only,
        )

    @staticmethod
    def _resolve_sso_protocol(value: object, *, field_name: str) -> feature_entities.SSOProtocol | None:
        if value is None or (isinstance(value, str) and not value.strip()):
            return None

        if not isinstance(value, str):
            logger.error("Invalid Enterprise SSO protocol for %s; disabling the protocol", field_name)
            return None

        try:
            return feature_entities.SSOProtocol(value)
        except ValueError:
            logger.error("Invalid Enterprise SSO protocol for %s; disabling the protocol", field_name)  # noqa: TRY400
            return None
