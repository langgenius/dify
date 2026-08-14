"""Feature query results and policy values shared by their consumers."""

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from enums import CloudPlan, DeploymentEdition


class FeatureResponseModel(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True, protected_namespaces=())


class SubscriptionModel(FeatureResponseModel):
    plan: CloudPlan = CloudPlan.SANDBOX
    interval: str = ""


class BillingModel(FeatureResponseModel):
    # Deprecated compatibility field. Deployment edition is the only source of truth for product edition.
    # TODO: Remove after clients migrate to `SystemFeatureModel.deployment_edition`.
    enabled: bool = Field(
        default=False,
        deprecated=True,
        description="Deprecated. Use system features deployment_edition to determine the product edition.",
    )
    subscription: SubscriptionModel = SubscriptionModel()


class EducationModel(FeatureResponseModel):
    enabled: bool = False
    activated: bool = False


class LimitationModel(FeatureResponseModel):
    size: int = 0
    limit: int = 0


class VectorSpaceLimitationModel(LimitationModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=False, protected_namespaces=())

    size: int
    limit: int
    usage_unknown: bool = Field(default=False, exclude_if=lambda value: not value)


class LicenseLimitationModel(FeatureResponseModel):
    """
    - enabled: whether this limit is enforced
    - size: current usage count
    - limit: maximum allowed count; 0 means unlimited
    """

    enabled: bool = Field(False, description="Whether this limit is currently active")
    size: int = Field(0, description="Number of resources already consumed")
    limit: int = Field(0, description="Maximum number of resources allowed; 0 means no limit")

    def is_available(self, required: int = 1) -> bool:
        """
        Determine whether the requested amount can be allocated.

        Returns True if:
         - this limit is not active, or
         - the limit is zero (unlimited), or
         - there is enough remaining quota.
        """
        if not self.enabled or self.limit == 0:
            return True

        return (self.limit - self.size) >= required


class Quota(FeatureResponseModel):
    usage: int = 0
    limit: int = 0
    reset_date: int = -1


class LicenseStatus(StrEnum):
    NONE = "none"
    INACTIVE = "inactive"
    ACTIVE = "active"
    EXPIRING = "expiring"
    EXPIRED = "expired"
    LOST = "lost"


class LicenseStatusModel(FeatureResponseModel):
    status: LicenseStatus = LicenseStatus.NONE


class LicenseModel(LicenseStatusModel):
    expired_at: str = ""
    workspaces: LicenseLimitationModel = LicenseLimitationModel(enabled=False, size=0, limit=0)
    seats: LicenseLimitationModel = LicenseLimitationModel(enabled=False, size=0, limit=0)
    license_expiry_notice_enabled: bool = False


class BrandingModel(FeatureResponseModel):
    enabled: bool = False
    application_title: str = ""
    login_page_logo: str = ""
    workspace_logo: str = ""
    favicon: str = ""


class SSOProtocol(StrEnum):
    SAML = "saml"
    OIDC = "oidc"
    OAUTH2 = "oauth2"


class WebAppAuthSSOModel(FeatureResponseModel):
    protocol: SSOProtocol | None = None


class WebAppAuthModel(FeatureResponseModel):
    enabled: bool = False
    allow_sso: bool = False
    sso_config: WebAppAuthSSOModel = Field(default_factory=WebAppAuthSSOModel)
    allow_email_code_login: bool = False
    allow_email_password_login: bool = False
    allow_public_access: bool = True


class KnowledgePipeline(FeatureResponseModel):
    publish_enabled: bool = False


class PluginInstallationScope(StrEnum):
    NONE = "none"
    OFFICIAL_ONLY = "official_only"
    OFFICIAL_AND_SPECIFIC_PARTNERS = "official_and_specific_partners"
    ALL = "all"


class PluginInstallationPermissionModel(FeatureResponseModel):
    # Plugin installation scope – possible values:
    #   none: prohibit all plugin installations
    #   official_only: allow only Dify official plugins
    #   official_and_specific_partners: allow official and specific partner plugins
    #   all: allow installation of all plugins
    plugin_installation_scope: PluginInstallationScope = PluginInstallationScope.ALL

    # If True, restrict plugin installation to the marketplace only
    # Equivalent to ForceEnablePluginVerification
    restrict_to_marketplace_only: bool = False


class FeatureModel(FeatureResponseModel):
    billing: BillingModel = BillingModel()
    education: EducationModel = EducationModel()
    members: LimitationModel = LimitationModel(size=0, limit=1)
    apps: LimitationModel = LimitationModel(size=0, limit=10)
    vector_space: LimitationModel | None = LimitationModel(size=0, limit=5)
    knowledge_rate_limit: int = 10
    annotation_quota_limit: LimitationModel = LimitationModel(size=0, limit=10)
    documents_upload_quota: LimitationModel = LimitationModel(size=0, limit=50)
    docs_processing: str = "standard"
    can_replace_logo: bool = False
    model_load_balancing_enabled: bool = False
    dataset_operator_enabled: bool = False
    webapp_copyright_enabled: bool = False
    workspace_members: LicenseLimitationModel = LicenseLimitationModel(enabled=False, size=0, limit=0)
    is_allow_transfer_workspace: bool = True
    trigger_event: Quota = Quota(usage=0, limit=3000, reset_date=0)
    api_rate_limit: Quota = Quota(usage=0, limit=5000, reset_date=0)
    # Controls whether email delivery is allowed for HumanInput nodes.
    human_input_email_delivery_enabled: bool = False
    knowledge_pipeline: KnowledgePipeline = KnowledgePipeline()
    next_credit_reset_date: int = 0


class KnowledgeRateLimitModel(FeatureResponseModel):
    enabled: bool = False
    limit: int = 10
    subscription_plan: str = ""


class SystemFeatureModel(FeatureResponseModel):
    """Non-sensitive bootstrap snapshot exposed before Console or Web authentication."""

    deployment_edition: DeploymentEdition
    enable_app_deploy: bool = False
    sso_enforced_for_signin: bool = False
    sso_enforced_for_signin_protocol: SSOProtocol | None = None
    enable_marketplace: bool = False
    enable_email_code_login: bool = False
    enable_email_password_login: bool = True
    enable_social_oauth_login: bool = False
    enable_collaboration_mode: bool = True
    is_allow_register: bool = False
    is_email_setup: bool = False
    license: LicenseStatusModel = LicenseStatusModel()
    branding: BrandingModel = BrandingModel()
    webapp_auth: WebAppAuthModel = Field(default_factory=WebAppAuthModel)
    plugin_installation_permission: PluginInstallationPermissionModel = PluginInstallationPermissionModel()
    enable_change_email: bool = True
    enable_creators_platform: bool = False
    enable_explore_banner: bool = False
    enable_learn_app: bool = True
    enable_step_by_step_tour: bool = False
    rbac_enabled: bool = False
    knowledge_fs_enabled: bool = False
