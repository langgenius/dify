import logging
from dataclasses import dataclass
from functools import cached_property

from configs import dify_config
from core.entities.provider_entities import ProviderQuotaType
from enums import CloudPlan, DeploymentEdition, HostedTrialProvider
from services.account_education_service import EDUCATION_EDITIONS
from services.billing_client import billing
from services.billing_service import BillingService
from services.credit_pool_service import CreditPoolBalance, CreditPoolService
from services.enterprise.enterprise_service import EnterpriseService
from services.entities import feature_entities
from services.errors.billing import BillingUpstreamUnavailableError
from services.knowledge_fs.feature_service import get_knowledge_fs_features

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ProviderCatalogBilling:
    """Lazy Billing reads for one workspace catalog. An outage disables only billing-backed routes.

    Cache even an unavailable result for this assembly, not across requests. Invalid responses
    propagate. This is a read model, not authorization to skip a credit reservation.
    """

    tenant_id: str

    @cached_property
    def subscription(self) -> billing.GetSubscriptionInfoReply | None:
        """Return the Cloud subscription if available; other editions never call Billing."""
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
            return None
        try:
            return BillingService.get_info(self.tenant_id, exclude_vector_space=True)
        except BillingUpstreamUnavailableError as exc:
            logger.warning("Billing subscription unavailable for workspace %s: %s", self.tenant_id, exc)
            return None

    @cached_property
    def pool_type(self) -> ProviderQuotaType | None:
        info = self.subscription
        if info is None:
            return None
        return FeatureService.get_credit_pool_type(self.tenant_id, plan=CloudPlan(info.subscription.plan))

    @property
    def load_balancing_enabled(self) -> bool | None:
        """None means unverified, not a negative entitlement that can be persisted in Redis."""
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
            return dify_config.MODEL_LB_ENABLED
        return self.subscription.model_load_balancing_enabled if self.subscription is not None else None

    @cached_property
    def balance(self) -> CreditPoolBalance | None:
        if self.pool_type is None:
            return None
        return CreditPoolService.get_pool_if_available(tenant_id=self.tenant_id, pool_type=self.pool_type)


class FeatureService:
    @staticmethod
    def is_im_centrally_managed() -> bool:
        """Enterprise centrally manages IM channels and default bindings."""
        return dify_config.DEPLOYMENT_EDITION == DeploymentEdition.ENTERPRISE

    @staticmethod
    def use_tenant_scoped_email_config() -> bool:
        """Cloud uses tenant Email Channels instead of the global mail client."""
        return dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD

    @staticmethod
    def is_agent_preview_enabled() -> bool:
        """Agent App preview runs are available on Cloud and Enterprise deployments only."""
        return dify_config.DEPLOYMENT_EDITION in {DeploymentEdition.CLOUD, DeploymentEdition.ENTERPRISE}

    @classmethod
    def can_import_premium_site_settings(cls, tenant_id: str) -> bool:
        """Keep Cloud-only Web app customization out of free workspace imports."""
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
            return True
        return cls._is_paid_cloud_workspace(tenant_id)

    @classmethod
    def get_workspace_plan(cls, tenant_id: str) -> CloudPlan | None:
        """Return the workspace's Cloud subscription plan, or ``None`` outside Cloud.

        This is the single entry for reading one workspace's plan. Only Cloud has
        subscription plans, so other editions return ``None`` without calling
        billing; ``None`` is never a stand-in for Sandbox. On Cloud it makes one
        billing subscription request. Batch jobs use
        ``BillingService.get_plan_bulk_with_cache`` instead.

        Billing failures propagate unchanged, and each caller chooses what they
        mean: permission checks reject the request (directly or as their own
        unavailable error), while queue routing and other scheduling decisions
        catch the failure and fall back to their degraded plan.
        """
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
            return None

        billing_info = BillingService.get_info(tenant_id, exclude_vector_space=True)
        return CloudPlan(billing_info.subscription.plan)

    @classmethod
    def get_credit_pool_type(cls, tenant_id: str, *, plan: CloudPlan | None = None) -> ProviderQuotaType | None:
        """Return the hosted credit pool a workspace spends from, or ``None`` outside Cloud.

        Only Cloud bills hosted model calls against a credit pool, and the plan selects the
        bucket: Sandbox spends trial credits while every paid plan spends paid credits. A
        caller that already loaded the subscription passes ``plan`` to skip a second lookup;
        billing failures propagate so the caller decides whether to fail closed.
        """
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
            return None

        workspace_plan = plan if plan is not None else cls.get_workspace_plan(tenant_id)
        return ProviderQuotaType.TRIAL if workspace_plan == CloudPlan.SANDBOX else ProviderQuotaType.PAID

    @classmethod
    def _is_paid_cloud_workspace(cls, tenant_id: str, plan: CloudPlan | None = None) -> bool:
        """Return whether a Cloud workspace has a paid plan, using ``plan`` when the caller already loaded it."""
        workspace_plan = plan if plan is not None else cls.get_workspace_plan(tenant_id)
        return workspace_plan is not None and workspace_plan.is_paid

    @classmethod
    def can_use_workflow_collaboration(cls, tenant_id: str, *, plan: CloudPlan | None = None) -> bool:
        """Return the workspace entitlement using its loaded plan, or propagate billing failures."""
        if not dify_config.ENABLE_COLLABORATION_MODE:
            return False
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
            return True
        if not tenant_id:
            return False
        return cls._is_paid_cloud_workspace(tenant_id, plan)

    @staticmethod
    def is_evaluation_supported() -> bool:
        """Report Evaluation's deployment availability before checking Cloud workspace plans."""
        return dify_config.ENABLE_EVALUATION and dify_config.DEPLOYMENT_EDITION in {
            DeploymentEdition.ENTERPRISE,
            DeploymentEdition.CLOUD,
        }

    @classmethod
    def can_use_evaluation(cls, tenant_id: str, *, plan: CloudPlan | None = None) -> bool:
        """Return the workspace entitlement using its loaded plan, or propagate billing failures."""
        if not cls.is_evaluation_supported():
            return False
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
            return True
        if not tenant_id:
            return False
        return cls._is_paid_cloud_workspace(tenant_id, plan)

    @classmethod
    def get_features(cls, tenant_id: str, exclude_vector_space: bool = False) -> feature_entities.FeatureModel:
        features = feature_entities.FeatureModel()
        features.im_centrally_managed = cls.is_im_centrally_managed()
        features.agent_preview_enabled = cls.is_agent_preview_enabled()
        if exclude_vector_space:
            features.vector_space = None

        cls._fulfill_params_from_env(features)

        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
            cls._lift_plan_quotas(features)

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
        plan = features.billing.subscription.plan
        features.workflow_collaboration_enabled = cls.can_use_workflow_collaboration(tenant_id, plan=plan)
        features.workflow_collaboration_upgrade_available = (
            dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD
            and plan == CloudPlan.SANDBOX
            and cls.can_use_workflow_collaboration(tenant_id, plan=CloudPlan.PROFESSIONAL)
        )
        features.evaluation_enabled = cls.can_use_evaluation(tenant_id, plan=plan)
        features.evaluation_upgrade_available = (
            dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD
            and plan == CloudPlan.SANDBOX
            and cls.can_use_evaluation(tenant_id, plan=CloudPlan.PROFESSIONAL)
        )

        return features

    @classmethod
    def get_vector_space(cls, tenant_id: str) -> feature_entities.VectorSpaceLimitationModel:
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
            return feature_entities.VectorSpaceLimitationModel(size=0, limit=-1)

        vector_space = feature_entities.VectorSpaceLimitationModel(size=0, limit=5)
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and tenant_id:
            billing_vector_space = BillingService.get_vector_space(tenant_id)
            # NOTE: billing API returns vector_space.size as float (e.g. 0.0),
            # but feature API keeps LimitationModel.size as int for compatibility.
            vector_space.size = int(billing_vector_space.size)
            vector_space.limit = billing_vector_space.limit
            vector_space.usage_unknown = billing_vector_space.usage_unknown or False

        return vector_space

    @staticmethod
    def has_knowledge_subscription_limits() -> bool:
        """Whether knowledge writes are subject to workspace subscription limits."""
        return dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD

    @classmethod
    def get_knowledge_rate_limit(cls, tenant_id: str) -> feature_entities.KnowledgeRateLimitModel:
        knowledge_rate_limit = feature_entities.KnowledgeRateLimitModel()
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and tenant_id:
            knowledge_rate_limit.enabled = True
            limit_info = BillingService.get_knowledge_rate_limit(tenant_id)
            knowledge_rate_limit.limit = limit_info.limit
            knowledge_rate_limit.subscription_plan = limit_info.subscription_plan
        return knowledge_rate_limit

    @classmethod
    def get_knowledge_file_size_limit(cls, tenant_id: str | None) -> int:
        default_limit = dify_config.UPLOAD_FILE_SIZE_LIMIT
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD or not tenant_id:
            return default_limit

        if cls._is_paid_cloud_workspace(tenant_id):
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
        return features.billing.subscription.plan.is_paid

    @classmethod
    def _fulfill_trial_models_from_env(cls, quota_types: tuple[str, ...] | None = None) -> list[str]:
        allowed_quota_types = quota_types or ("PAID", "TRIAL")
        return [
            provider.value
            for provider in HostedTrialProvider
            if any(
                getattr(dify_config, f"HOSTED_{provider.config_key}_{quota_type}_ENABLED", False)
                for quota_type in allowed_quota_types
            )
        ]

    @classmethod
    def get_trial_models(cls, tenant_id: str) -> list[str]:
        """List eligible credit providers, or none when the Cloud subscription is unavailable.

        Outside Cloud this remains the deployment's provider list, not an entitlement to hosted credits.
        """
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
            return cls._fulfill_trial_models_from_env()
        pool_type = ProviderCatalogBilling(tenant_id).pool_type
        return cls._fulfill_trial_models_from_env((pool_type.name,)) if pool_type is not None else []

    @classmethod
    def _fulfill_params_from_env(cls, features: feature_entities.FeatureModel) -> None:
        features.can_replace_logo = dify_config.CAN_REPLACE_LOGO
        features.model_load_balancing_enabled = dify_config.MODEL_LB_ENABLED
        features.education.enabled = (
            dify_config.EDUCATION_ENABLED and dify_config.DEPLOYMENT_EDITION in EDUCATION_EDITIONS
        )
        features.enable_skill = dify_config.ENABLE_SKILL
        features.dify_builder_enabled = dify_config.DIFY_BUILDER_ENABLED
        features.skill_learning_policy = dify_config.DIFY_BUILDER_SKILL_LEARNING_POLICY
        features.enable_knowledge_fs = get_knowledge_fs_features().enabled
        features.enable_file_scan = dify_config.FILE_SCAN_ENABLED

    @classmethod
    def _lift_plan_quotas(cls, features: feature_entities.FeatureModel):
        """Subscription quotas only exist on Cloud; other editions report them as unlimited."""
        features.members = feature_entities.LimitationModel(size=0, limit=0)
        features.apps = feature_entities.LimitationModel(size=0, limit=0)
        features.annotation_quota_limit = feature_entities.LimitationModel(size=0, limit=0)
        features.documents_upload_quota = feature_entities.LimitationModel(size=0, limit=0)
        if features.vector_space is not None:
            features.vector_space = feature_entities.LimitationModel(size=0, limit=-1)
        features.trigger_event = feature_entities.Quota(usage=0, limit=-1, reset_date=-1)
        features.api_rate_limit = feature_entities.Quota(usage=0, limit=-1, reset_date=-1)

    @classmethod
    def _fulfill_params_from_workspace_info(cls, features: feature_entities.FeatureModel, tenant_id: str) -> None:
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
    ) -> None:
        if exclude_vector_space:
            billing_info = BillingService.get_info(tenant_id, exclude_vector_space=True)
        else:
            billing_info = BillingService.get_info(tenant_id)

        features.billing.subscription.plan = CloudPlan(billing_info.subscription.plan)
        features.billing.subscription.interval = billing_info.subscription.interval
        features.education.activated = billing_info.subscription.education
        features_usage_info = BillingService.get_quota_info(tenant_id)

        if features.billing.subscription.plan != CloudPlan.SANDBOX:
            features.webapp_copyright_enabled = True
        else:
            features.is_allow_transfer_workspace = False

        features.trigger_event.usage = features_usage_info.trigger_event.usage
        features.trigger_event.limit = features_usage_info.trigger_event.limit
        features.trigger_event.reset_date = features_usage_info.trigger_event.reset_date

        features.api_rate_limit.usage = features_usage_info.api_rate_limit.usage
        features.api_rate_limit.limit = features_usage_info.api_rate_limit.limit
        features.api_rate_limit.reset_date = features_usage_info.api_rate_limit.reset_date

        features.members.size = billing_info.members.size
        features.members.limit = billing_info.members.limit

        features.apps.size = billing_info.apps.size
        features.apps.limit = billing_info.apps.limit

        if not exclude_vector_space:
            assert features.vector_space is not None
            cls._fulfill_vector_space_from_billing_info(features.vector_space, billing_info)

        features.documents_upload_quota.size = billing_info.documents_upload_quota.size
        features.documents_upload_quota.limit = billing_info.documents_upload_quota.limit

        features.annotation_quota_limit.size = billing_info.annotation_quota_limit.size
        features.annotation_quota_limit.limit = billing_info.annotation_quota_limit.limit

        features.can_replace_logo = billing_info.can_replace_logo
        features.model_load_balancing_enabled = billing_info.model_load_balancing_enabled
        features.knowledge_pipeline.publish_enabled = billing_info.knowledge_pipeline_publish_enabled
        features.next_credit_reset_date = billing_info.next_credit_reset_date

    @classmethod
    def _fulfill_vector_space_from_billing_info(
        cls, vector_space: feature_entities.LimitationModel, billing_info: billing.GetSubscriptionInfoReply
    ) -> None:
        if billing_info.vector_space is None:
            return

        # NOTE: billing API returns vector_space.size as float (e.g. 0.0),
        # but feature API keeps LimitationModel.size as int for compatibility.
        vector_space.size = int(billing_info.vector_space.size)
        vector_space.limit = billing_info.vector_space.limit
