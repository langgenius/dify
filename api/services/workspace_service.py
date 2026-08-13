from dataclasses import dataclass
from typing import Literal

from flask_login import current_user
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from enums import CloudPlan, DeploymentEdition
from models.account import Tenant, TenantAccountJoin, TenantAccountRole
from services.account_service import TenantService
from services.billing_service import BillingService
from services.feature_service import FeatureService


@dataclass(frozen=True)
class EffectiveCreditPool:
    plan: CloudPlan | None = None
    pool_type: Literal["paid", "trial"] | None = None
    quota_limit: int | None = None
    quota_used: int | None = None
    exhausted_at: int | None = None
    next_credit_reset_date: int | None = None

    @property
    def remaining_credits(self) -> int | None:
        if self.quota_limit is None or self.quota_used is None:
            return None
        if self.is_unlimited:
            return -1
        return max(0, self.quota_limit - self.quota_used)

    @property
    def is_unlimited(self) -> bool:
        return self.quota_limit == -1

    @property
    def is_exhausted(self) -> bool:
        remaining_credits = self.remaining_credits
        return not self.is_unlimited and (remaining_credits is None or remaining_credits <= 0)


def _set_credit_pool_info(
    tenant_info: dict[str, object], *, quota_limit: int, quota_used: int, exhausted_at: int | None = None
) -> None:
    tenant_info["trial_credits"] = quota_limit
    tenant_info["trial_credits_used"] = quota_used
    if isinstance(exhausted_at, int) and exhausted_at > 0 and quota_limit > 0 and quota_used >= quota_limit:
        tenant_info["trial_credits_exhausted_at"] = exhausted_at


class WorkspaceService:
    @classmethod
    def get_effective_credit_pool(cls, tenant_id: str, *, session: Session) -> EffectiveCreditPool:
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
            return EffectiveCreditPool()

        billing_info = BillingService.get_info(tenant_id, exclude_vector_space=True)
        subscription_plan = CloudPlan(billing_info["subscription"]["plan"])

        from services.credit_pool_service import CreditPoolBalance, CreditPoolService

        effective_pool = None
        effective_pool_type: Literal["paid", "trial"] = "trial"
        if subscription_plan != CloudPlan.SANDBOX:
            paid_pool = CreditPoolService.get_pool(tenant_id=tenant_id, pool_type="paid", session=session)
            if paid_pool is not None and (paid_pool.quota_limit == -1 or paid_pool.quota_limit > paid_pool.quota_used):
                effective_pool = paid_pool
                effective_pool_type = "paid"

        if effective_pool is None:
            effective_pool = CreditPoolService.get_pool(tenant_id=tenant_id, pool_type="trial", session=session)

        if effective_pool is None:
            return EffectiveCreditPool(
                plan=subscription_plan if billing_info["enabled"] else None,
                next_credit_reset_date=billing_info.get("next_credit_reset_date"),
            )

        exhausted_at = effective_pool.exhausted_at if isinstance(effective_pool, CreditPoolBalance) else None
        if not (
            isinstance(exhausted_at, int)
            and exhausted_at > 0
            and effective_pool.quota_limit > 0
            and effective_pool.quota_used >= effective_pool.quota_limit
        ):
            exhausted_at = None

        return EffectiveCreditPool(
            plan=subscription_plan if billing_info["enabled"] else None,
            pool_type=effective_pool_type,
            quota_limit=effective_pool.quota_limit,
            quota_used=effective_pool.quota_used,
            exhausted_at=exhausted_at,
            next_credit_reset_date=billing_info.get("next_credit_reset_date"),
        )

    @classmethod
    def get_current_workspace_summary(cls, tenant: Tenant, account_id: str, *, session: Session) -> dict[str, object]:
        tenant_account_join = session.scalar(
            select(TenantAccountJoin)
            .where(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.account_id == account_id)
            .limit(1)
        )
        assert tenant_account_join is not None, "TenantAccountJoin not found"

        effective_pool = cls.get_effective_credit_pool(tenant.id, session=session)

        return {
            "id": tenant.id,
            "name": tenant.name,
            "role": tenant_account_join.role,
            "plan": effective_pool.plan,
            "credits": effective_pool.remaining_credits,
        }

    @classmethod
    def get_tenant_info(cls, tenant: Tenant, session: Session):
        if not tenant:
            return None
        tenant_info: dict[str, object] = {
            "id": tenant.id,
            "name": tenant.name,
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
        tenant_info["plan"] = feature.billing.subscription.plan if feature.billing.enabled else None
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
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            tenant_info["next_credit_reset_date"] = feature.next_credit_reset_date

            from services.credit_pool_service import CreditPoolBalance, CreditPoolService

            paid_pool = CreditPoolService.get_pool(tenant_id=tenant.id, pool_type="paid", session=session)
            # if the tenant is not on the sandbox plan and the paid pool is not full, use the paid pool
            if (
                feature.billing.subscription.plan != CloudPlan.SANDBOX
                and paid_pool is not None
                and (paid_pool.quota_limit == -1 or paid_pool.quota_limit > paid_pool.quota_used)
            ):
                exhausted_at = paid_pool.exhausted_at if isinstance(paid_pool, CreditPoolBalance) else None
                _set_credit_pool_info(
                    tenant_info,
                    quota_limit=paid_pool.quota_limit,
                    quota_used=paid_pool.quota_used,
                    exhausted_at=exhausted_at,
                )
            else:
                trial_pool = CreditPoolService.get_pool(tenant_id=tenant.id, pool_type="trial", session=session)
                if trial_pool:
                    exhausted_at = trial_pool.exhausted_at if isinstance(trial_pool, CreditPoolBalance) else None
                    _set_credit_pool_info(
                        tenant_info,
                        quota_limit=trial_pool.quota_limit,
                        quota_used=trial_pool.quota_used,
                        exhausted_at=exhausted_at,
                    )

        return tenant_info
