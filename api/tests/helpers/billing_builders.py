"""Generated billing models with defaults, so tests state only the fields they care about."""

from services.billing_client import billing


def subscription_plan(plan: str = "sandbox", **fields: object) -> billing.BillingSubscriptionPlan:
    defaults: dict[str, object] = {
        "interval": "",
        "education": False,
        "status": "",
        "cancel_at_period_end": False,
        "paid_period_end": 0,
    }
    return billing.BillingSubscriptionPlan.model_validate({"plan": plan} | defaults | fields)


def subscription_info(plan: str = "sandbox", **fields: object) -> billing.GetSubscriptionInfoReply:
    defaults: dict[str, object] = {
        "enabled": True,
        "subscription": subscription_plan(plan),
        "members": billing.SubscriptionQuota(size=0, limit=1),
        "apps": billing.SubscriptionQuota(size=0, limit=10),
        "vector_space": None,
        "knowledge_rate_limit": billing.KnowledgeRateLimit(size=0, limit=10),
        "documents_upload_quota": billing.SubscriptionQuota(size=0, limit=50),
        "annotation_quota_limit": billing.SubscriptionQuota(size=0, limit=10),
        "docs_processing": "standard",
        "can_replace_logo": False,
        "model_load_balancing_enabled": False,
        "knowledge_pipeline_publish_enabled": False,
        "next_credit_reset_date": 0,
    }
    return billing.GetSubscriptionInfoReply.model_validate(defaults | fields)


def vector_space(size: float = 0.0, limit: int = 0, usage_unknown: bool | None = None) -> billing.VectorSpaceQuota:
    return billing.VectorSpaceQuota(size=size, limit=limit, usage_unknown=usage_unknown)


def plan_item(plan: str = "sandbox", expiration_date: int = -1) -> billing.SubscriptionPlanItem:
    return billing.SubscriptionPlanItem.model_validate({"plan": plan, "expiration_date": expiration_date})
