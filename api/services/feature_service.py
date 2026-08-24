import logging
from collections.abc import Mapping

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from configs import dify_config
from enums import CloudPlan, DeploymentEdition, HostedTrialProvider
from services.billing_service import BillingInfo, BillingService
from services.enterprise.enterprise_service import EnterpriseService
from services.entities import feature_entities

logger = logging.getLogger(__name__)


class _EnterprisePluginInstallationPermission(BaseModel):
    model_config = ConfigDict(extra="ignore")

    plugin_installation_scope: feature_entities.PluginInstallationScope = Field(alias="pluginInstallationScope")
    restrict_to_marketplace_only: bool = Field(alias="restrictToMarketplaceOnly", strict=True)


class FeatureService:
    @classmethod
    def get_features(cls, tenant_id: str, exclude_vector_space: bool = False) -> feature_entities.FeatureModel:
        features = feature_entities.FeatureModel()
        if exclude_vector_space:
            features.vector_space = None

        cls._fulfill_params_from_env(features)

        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and tenant_id:
            cls._fulfill_params_from_billing_api(
                features,
                tenant_id,
                exclude_vector_space=exclude_vector_space,
            )

        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.ENTERPRISE:
            features.webapp_copyright_enabled = True
            features.knowledge_pipeline.publish_enabled = True
            cls._fulfill_params_from_workspace_info(features, tenant_id)

        features.human_input_email_delivery_enabled = cls._resolve_human_input_email_delivery_enabled(
            features=features,
            tenant_id=tenant_id,
        )

        return features

    @classmethod
    def get_vector_space(cls, tenant_id: str) -> feature_entities.VectorSpaceLimitationModel:
        vector_space = feature_entities.VectorSpaceLimitationModel(size=0, limit=5)
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and tenant_id:
            billing_vector_space = BillingService.get_vector_space(tenant_id)
            # NOTE: billing API returns vector_space.size as float (e.g. 0.0),
            # but feature API keeps LimitationModel.size as int for compatibility.
            vector_space.size = int(billing_vector_space["size"])
            vector_space.limit = billing_vector_space["limit"]
            vector_space.usage_unknown = billing_vector_space.get("usage_unknown", False)

        return vector_space

    @classmethod
    def get_knowledge_rate_limit(cls, tenant_id: str):
        knowledge_rate_limit = feature_entities.KnowledgeRateLimitModel()
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and tenant_id:
            knowledge_rate_limit.enabled = True
            limit_info = BillingService.get_knowledge_rate_limit(tenant_id)
            knowledge_rate_limit.limit = limit_info.get("limit", 10)
            knowledge_rate_limit.subscription_plan = limit_info.get("subscription_plan", CloudPlan.SANDBOX)
        return knowledge_rate_limit

    @classmethod
    def get_knowledge_file_size_limit(cls, tenant_id: str | None) -> int:
        default_limit = dify_config.UPLOAD_FILE_SIZE_LIMIT
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD or not tenant_id:
            return default_limit

        billing_info = BillingService.get_info(tenant_id, exclude_vector_space=True)
        if billing_info["enabled"] and billing_info["subscription"]["plan"] in (
            CloudPlan.PROFESSIONAL,
            CloudPlan.TEAM,
        ):
            return max(default_limit, dify_config.KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN)

        return default_limit

    @classmethod
    def _resolve_human_input_email_delivery_enabled(
        cls, *, features: feature_entities.FeatureModel, tenant_id: str | None
    ) -> bool:
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
            return True
        if not tenant_id:
            return False
        return features.billing.enabled and features.billing.subscription.plan in (
            CloudPlan.PROFESSIONAL,
            CloudPlan.TEAM,
        )

    @classmethod
    def get_system_features(cls) -> feature_entities.SystemFeatureModel:
        system_features = feature_entities.SystemFeatureModel(deployment_edition=dify_config.DEPLOYMENT_EDITION)
        system_features.rbac_enabled = dify_config.RBAC_ENABLED

        cls._fulfill_system_params_from_env(system_features)
        system_features.webapp_auth.enabled = cls.is_webapp_auth_enabled()

        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.ENTERPRISE:
            system_features.branding.enabled = True
            system_features.enable_change_email = False
            cls._fulfill_params_from_enterprise(system_features)

        if dify_config.MARKETPLACE_ENABLED:
            system_features.enable_marketplace = True

        if dify_config.CREATORS_PLATFORM_FEATURES_ENABLED:
            system_features.enable_creators_platform = True

        return system_features

    @classmethod
    def is_workspace_creation_allowed(cls) -> bool:
        """Resolve the backend workspace-creation policy, including the Enterprise override."""
        is_allowed = dify_config.ALLOW_CREATE_WORKSPACE
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
            return is_allowed

        enterprise_info = EnterpriseService.get_info()
        return bool(enterprise_info.get("IsAllowCreateWorkspace", is_allowed))

    @classmethod
    def is_plugin_manager_enabled(cls) -> bool:
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
        """Return full license detail. Enterprise-only; requires an authenticated caller.

        Non-enterprise deployments have no license, so an unconstrained default
        (unlimited seats/workspaces) is returned.
        """
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
            return feature_entities.LicenseModel()
        license_model = cls._build_license(EnterpriseService.get_info())
        license_model.license_expiry_notice_enabled = dify_config.ENABLE_LICENSE_EXPIRY_NOTICE
        return license_model

    @staticmethod
    def is_explore_banner_enabled() -> bool:
        return dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and dify_config.ENABLE_EXPLORE_BANNER

    @staticmethod
    def is_webapp_auth_enabled() -> bool:
        return dify_config.DEPLOYMENT_EDITION == DeploymentEdition.ENTERPRISE

    @staticmethod
    def is_trial_app_enabled() -> bool:
        return dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and dify_config.ENABLE_TRIAL_APP

    @classmethod
    def _fulfill_system_params_from_env(cls, system_features: feature_entities.SystemFeatureModel):
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
    def _fulfill_trial_models_from_env(cls) -> list[str]:
        return [
            provider.value
            for provider in HostedTrialProvider
            if (
                getattr(dify_config, f"HOSTED_{provider.config_key}_PAID_ENABLED", False)
                and getattr(dify_config, f"HOSTED_{provider.config_key}_TRIAL_ENABLED", False)
            )
        ]

    @classmethod
    def get_trial_models(cls) -> list[str]:
        """Return hosted trial provider ids without requiring the full system-features payload."""
        return cls._fulfill_trial_models_from_env()

    @classmethod
    def _fulfill_params_from_env(cls, features: feature_entities.FeatureModel):
        features.can_replace_logo = dify_config.CAN_REPLACE_LOGO
        features.model_load_balancing_enabled = dify_config.MODEL_LB_ENABLED
        features.dataset_operator_enabled = dify_config.DATASET_OPERATOR_ENABLED
        features.education.enabled = dify_config.EDUCATION_ENABLED

    @classmethod
    def _fulfill_params_from_workspace_info(cls, features: feature_entities.FeatureModel, tenant_id: str):
        workspace_info = EnterpriseService.get_workspace_info(tenant_id)
        if "WorkspaceMembers" in workspace_info:
            features.workspace_members.size = workspace_info["WorkspaceMembers"]["used"]
            features.workspace_members.limit = workspace_info["WorkspaceMembers"]["limit"]
            features.workspace_members.enabled = workspace_info["WorkspaceMembers"]["enabled"]

    @classmethod
    def _fulfill_params_from_billing_api(
        cls,
        features: feature_entities.FeatureModel,
        tenant_id: str,
        exclude_vector_space: bool = False,
    ):
        if exclude_vector_space:
            billing_info = BillingService.get_info(tenant_id, exclude_vector_space=True)
        else:
            billing_info = BillingService.get_info(tenant_id)

        features_usage_info = BillingService.get_quota_info(tenant_id)

        features.billing.enabled = billing_info["enabled"]
        features.billing.subscription.plan = CloudPlan(billing_info["subscription"]["plan"])
        features.billing.subscription.interval = billing_info["subscription"]["interval"]
        features.education.activated = billing_info["subscription"].get("education", False)

        if features.billing.subscription.plan != CloudPlan.SANDBOX:
            features.webapp_copyright_enabled = True
        else:
            features.is_allow_transfer_workspace = False

        if "trigger_event" in features_usage_info:
            features.trigger_event.usage = features_usage_info["trigger_event"]["usage"]
            features.trigger_event.limit = features_usage_info["trigger_event"]["limit"]
            features.trigger_event.reset_date = features_usage_info["trigger_event"].get("reset_date", -1)

        if "api_rate_limit" in features_usage_info:
            features.api_rate_limit.usage = features_usage_info["api_rate_limit"]["usage"]
            features.api_rate_limit.limit = features_usage_info["api_rate_limit"]["limit"]
            features.api_rate_limit.reset_date = features_usage_info["api_rate_limit"].get("reset_date", -1)

        if "members" in billing_info:
            features.members.size = billing_info["members"]["size"]
            features.members.limit = billing_info["members"]["limit"]

        if "apps" in billing_info:
            features.apps.size = billing_info["apps"]["size"]
            features.apps.limit = billing_info["apps"]["limit"]

        if not exclude_vector_space:
            assert features.vector_space is not None
            cls._fulfill_vector_space_from_billing_info(features.vector_space, billing_info)

        if "documents_upload_quota" in billing_info:
            features.documents_upload_quota.size = billing_info["documents_upload_quota"]["size"]
            features.documents_upload_quota.limit = billing_info["documents_upload_quota"]["limit"]

        if "annotation_quota_limit" in billing_info:
            features.annotation_quota_limit.size = billing_info["annotation_quota_limit"]["size"]
            features.annotation_quota_limit.limit = billing_info["annotation_quota_limit"]["limit"]

        if "docs_processing" in billing_info:
            features.docs_processing = billing_info["docs_processing"]

        if "can_replace_logo" in billing_info:
            features.can_replace_logo = billing_info["can_replace_logo"]

        if "model_load_balancing_enabled" in billing_info:
            features.model_load_balancing_enabled = billing_info["model_load_balancing_enabled"]

        if "knowledge_rate_limit" in billing_info:
            # NOTE (hj24):
            # 1. knowledge_rate_limit size is nullable, currently it's defined but never used, only limit is used.
            # 2. So be careful if later we decide to use [size], we cannot assume it is always present.
            features.knowledge_rate_limit = billing_info["knowledge_rate_limit"]["limit"]
            # NOTE END

        if "knowledge_pipeline_publish_enabled" in billing_info:
            features.knowledge_pipeline.publish_enabled = billing_info["knowledge_pipeline_publish_enabled"]

        if "next_credit_reset_date" in billing_info:
            features.next_credit_reset_date = billing_info["next_credit_reset_date"]

    @classmethod
    def _fulfill_vector_space_from_billing_info(
        cls, vector_space: feature_entities.LimitationModel, billing_info: BillingInfo
    ):
        if "vector_space" not in billing_info:
            return

        # NOTE: billing API returns vector_space.size as float (e.g. 0.0),
        # but feature API keeps LimitationModel.size as int for compatibility.
        vector_space.size = int(billing_info["vector_space"]["size"])
        vector_space.limit = billing_info["vector_space"]["limit"]

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
            # Do not attach the exception because it may contain raw Enterprise configuration values.
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
            logger.error(  # noqa: TRY400
                "Invalid Enterprise SSO protocol for %s; disabling the protocol", field_name
            )
            return None

    @classmethod
    def _fulfill_params_from_enterprise(cls, features: feature_entities.SystemFeatureModel):
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

        # SECURITY NOTE: system-features is unauthenticated, so it exposes only license
        # *status* — enough for the login page to detect an expired/inactive license after
        # force-logout. Full license detail (expiry, workspace/seat usage) is served
        # separately by get_license() behind an authenticated endpoint.
        if license_info := enterprise_info.get("License"):
            features.license = feature_entities.LicenseStatusModel(
                status=feature_entities.LicenseStatus(
                    license_info.get("status", feature_entities.LicenseStatus.INACTIVE)
                )
            )

        features.plugin_installation_permission = cls._resolve_plugin_installation_permission(enterprise_info)
