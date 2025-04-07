from enum import StrEnum

from pydantic import BaseModel, ConfigDict

from configs import dify_config
from services.billing_service import BillingService
from services.enterprise.enterprise_service import EnterpriseService


class SubscriptionModel(BaseModel):
    plan: str = "sandbox"
    interval: str = ""


class BillingModel(BaseModel):
    enabled: bool = False
    subscription: SubscriptionModel = SubscriptionModel()


class LimitationModel(BaseModel):
    size: int = 0
    limit: int = 0


class LicenseStatus(StrEnum):
    NONE = "none"
    INACTIVE = "inactive"
    ACTIVE = "active"
    EXPIRING = "expiring"
    EXPIRED = "expired"
    LOST = "lost"


class LicenseModel(BaseModel):
    status: LicenseStatus = LicenseStatus.NONE
    expired_at: str = ""


class BrandingModel(BaseModel):
    enabled: bool = False
    application_title: str = ""
    login_page_logo: str = ""
    workspace_logo: str = ""
    favicon: str = ""


class WebAppAuthModel(BaseModel):
    enabled: bool = False
    allow_sso: bool = False
    allow_email_code_login: bool = False
    allow_email_password_login: bool = False


class FeatureModel(BaseModel):
    billing: BillingModel = BillingModel()
    members: LimitationModel = LimitationModel(size=0, limit=1)
    apps: LimitationModel = LimitationModel(size=0, limit=10)
    vector_space: LimitationModel = LimitationModel(size=0, limit=5)
    annotation_quota_limit: LimitationModel = LimitationModel(size=0, limit=10)
    documents_upload_quota: LimitationModel = LimitationModel(size=0, limit=50)
    docs_processing: str = "standard"
    can_replace_logo: bool = False
    model_load_balancing_enabled: bool = False
    dataset_operator_enabled: bool = False
    webapp_copyright_enabled: bool = False

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())


class SystemFeatureModel(BaseModel):
    sso_enforced_for_signin: bool = False
    sso_enforced_for_signin_protocol: str = ""
    sso_enforced_for_web: bool = False
    sso_enforced_for_web_protocol: str = ""
    enable_web_sso_switch_component: bool = False
    enable_email_code_login: bool = False
    enable_email_password_login: bool = True
    enable_social_oauth_login: bool = False
    is_allow_register: bool = False
    is_allow_create_workspace: bool = False
    is_email_setup: bool = False
    license: LicenseModel = LicenseModel()
    branding: BrandingModel = BrandingModel()
    webapp_auth: WebAppAuthModel = WebAppAuthModel()


class FeatureService:
    @classmethod
    def get_features(cls, tenant_id: str) -> FeatureModel:
        features = FeatureModel()

        cls._fulfill_params_from_env(features)

        if dify_config.BILLING_ENABLED and tenant_id:
            cls._fulfill_params_from_billing_api(features, tenant_id)

        if dify_config.ENTERPRISE_ENABLED:
            features.webapp_copyright_enabled = True

        return features

    @classmethod
    def get_system_features(cls) -> SystemFeatureModel:
        system_features = SystemFeatureModel()

        cls._fulfill_system_params_from_env(system_features)

        if dify_config.ENTERPRISE_ENABLED:
            system_features.enable_web_sso_switch_component = True
            system_features.branding.enabled = True
            system_features.webapp_auth.enabled = True
            cls._fulfill_params_from_enterprise(system_features)

        return system_features

    @classmethod
    def _fulfill_system_params_from_env(cls, system_features: SystemFeatureModel):
        system_features.enable_email_code_login = dify_config.ENABLE_EMAIL_CODE_LOGIN
        system_features.enable_email_password_login = dify_config.ENABLE_EMAIL_PASSWORD_LOGIN
        system_features.enable_social_oauth_login = dify_config.ENABLE_SOCIAL_OAUTH_LOGIN
        system_features.is_allow_register = dify_config.ALLOW_REGISTER
        system_features.is_allow_create_workspace = dify_config.ALLOW_CREATE_WORKSPACE
        system_features.is_email_setup = dify_config.MAIL_TYPE is not None and dify_config.MAIL_TYPE != ""

    @classmethod
    def _fulfill_params_from_env(cls, features: FeatureModel):
        features.can_replace_logo = dify_config.CAN_REPLACE_LOGO
        features.model_load_balancing_enabled = dify_config.MODEL_LB_ENABLED
        features.dataset_operator_enabled = dify_config.DATASET_OPERATOR_ENABLED

    @classmethod
    def _fulfill_params_from_billing_api(cls, features: FeatureModel, tenant_id: str):
        billing_info = BillingService.get_info(tenant_id)

        features.billing.enabled = billing_info["enabled"]
        features.billing.subscription.plan = billing_info["subscription"]["plan"]
        features.billing.subscription.interval = billing_info["subscription"]["interval"]

        if features.billing.subscription.plan != "sandbox":
            features.webapp_copyright_enabled = True

        if "members" in billing_info:
            features.members.size = billing_info["members"]["size"]
            features.members.limit = billing_info["members"]["limit"]

        if "apps" in billing_info:
            features.apps.size = billing_info["apps"]["size"]
            features.apps.limit = billing_info["apps"]["limit"]

        if "vector_space" in billing_info:
            features.vector_space.size = billing_info["vector_space"]["size"]
            features.vector_space.limit = billing_info["vector_space"]["limit"]

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

    @classmethod
    def _fulfill_params_from_enterprise(cls, features):
        enterprise_info = EnterpriseService.get_info()

        if "SSOEnforcedForSignin" in enterprise_info:
            features.sso_enforced_for_signin = enterprise_info["SSOEnforcedForSignin"]

        if "SSOEnforcedForSigninProtocol" in enterprise_info:
            features.sso_enforced_for_signin_protocol = enterprise_info["SSOEnforcedForSigninProtocol"]

        if "SSOEnforcedForWeb" in enterprise_info:
            features.sso_enforced_for_web = enterprise_info["SSOEnforcedForWeb"]

        if "SSOEnforcedForWebProtocol" in enterprise_info:
            features.sso_enforced_for_web_protocol = enterprise_info["SSOEnforcedForWebProtocol"]

        if "EnableEmailCodeLogin" in enterprise_info:
            features.enable_email_code_login = enterprise_info["EnableEmailCodeLogin"]

        if "EnableEmailPasswordLogin" in enterprise_info:
            features.enable_email_password_login = enterprise_info["EnableEmailPasswordLogin"]

        if "IsAllowRegister" in enterprise_info:
            features.is_allow_register = enterprise_info["IsAllowRegister"]

        if "IsAllowCreateWorkspace" in enterprise_info:
            features.is_allow_create_workspace = enterprise_info["IsAllowCreateWorkspace"]

        if "Branding" in enterprise_info:
            features.branding.application_title = enterprise_info["Branding"].get("applicationTitle", "")
            features.branding.login_page_logo = enterprise_info["Branding"].get("loginPageLogo", "")
            features.branding.workspace_logo = enterprise_info["Branding"].get("workspaceLogo", "")
            features.branding.favicon = enterprise_info["Branding"].get("favicon", "")

        if "WebAppAuth" in enterprise_info:
            features.webapp_auth.allow_sso = enterprise_info["WebAppAuth"].get("allowSSO", False)
            features.webapp_auth.allow_email_code_login = enterprise_info["WebAppAuth"].get("allowEmailCodeLogin", False)
            features.webapp_auth.allow_email_password_login = enterprise_info["WebAppAuth"].get("allowEmailPasswordLogin", False)

        if "License" in enterprise_info:
            license_info = enterprise_info["License"]

            if "status" in license_info:
                features.license.status = LicenseStatus(license_info.get("status", LicenseStatus.INACTIVE))

            if "expiredAt" in license_info:
                features.license.expired_at = license_info["expiredAt"]
