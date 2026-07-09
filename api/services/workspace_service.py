from typing import Protocol

from flask_login import current_user
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from enums.cloud_plan import CloudPlan
from models.account import Tenant, TenantAccountJoin, TenantAccountRole
from services.account_service import TenantService
from services.feature_service import FeatureService


class _CreditPoolLike(Protocol):
    quota_limit: int
    quota_used: int


def _set_credit_pool_info(tenant_info: dict[str, object], pool: _CreditPoolLike) -> None:
    tenant_info["trial_credits"] = pool.quota_limit
    tenant_info["trial_credits_used"] = pool.quota_used
    exhausted_at = getattr(pool, "exhausted_at", None)
    if (
        isinstance(exhausted_at, int)
        and exhausted_at > 0
        and pool.quota_limit > 0
        and pool.quota_used >= pool.quota_limit
    ):
        tenant_info["trial_credits_exhausted_at"] = exhausted_at


class WorkspaceService:
    @classmethod
    def get_tenant_info(cls, tenant: Tenant, session: Session):
        if not tenant:
            return None
        tenant_info: dict[str, object] = {
            "id": tenant.id,
            "name": tenant.name,
            "plan": tenant.plan,
            "status": tenant.status,
            "created_at": tenant.created_at,
            "trial_end_reason": None,
            "role": "normal",
        }

        # Get role of user
        tenant_account_join = session.scalar(
            select(TenantAccountJoin)
            .where(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.account_id == current_user.id)
            .limit(1)
        )
        assert tenant_account_join is not None, "TenantAccountJoin not found"
        tenant_info["role"] = tenant_account_join.role

        feature = FeatureService.get_features(tenant.id, exclude_vector_space=True)
        can_replace_logo = feature.can_replace_logo

        if can_replace_logo and TenantService.has_roles(
            tenant, [TenantAccountRole.OWNER, TenantAccountRole.ADMIN], session=session
        ):
            base_url = dify_config.FILES_URL
            replace_webapp_logo = (
                f"{base_url}/files/workspaces/{tenant.id}/webapp-logo"
                if tenant.custom_config_dict.get("replace_webapp_logo")
                else None
            )
            remove_webapp_brand = tenant.custom_config_dict.get("remove_webapp_brand", False)

            tenant_info["custom_config"] = {
                "remove_webapp_brand": remove_webapp_brand,
                "replace_webapp_logo": replace_webapp_logo,
            }
        if dify_config.EDITION == "CLOUD":
            tenant_info["next_credit_reset_date"] = feature.next_credit_reset_date

            from services.credit_pool_service import CreditPoolService

            paid_pool = CreditPoolService.get_pool(tenant_id=tenant.id, pool_type="paid", session=session)
            # if the tenant is not on the sandbox plan and the paid pool is not full, use the paid pool
            if (
                feature.billing.subscription.plan != CloudPlan.SANDBOX
                and paid_pool is not None
                and (paid_pool.quota_limit == -1 or paid_pool.quota_limit > paid_pool.quota_used)
            ):
                _set_credit_pool_info(tenant_info, paid_pool)
            else:
                trial_pool = CreditPoolService.get_pool(tenant_id=tenant.id, pool_type="trial", session=session)
                if trial_pool:
                    _set_credit_pool_info(tenant_info, trial_pool)

        return tenant_info
