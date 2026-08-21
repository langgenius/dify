from configs import dify_config
from enums import CloudPlan, DeploymentEdition
from services.billing_service import BillingInfo, BillingService
from services.enterprise.enterprise_service import EnterpriseService
from services.entities import feature_entities


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
