import logging
from dataclasses import dataclass, replace
from typing import Literal

from flask_login import current_user
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.model_billing_profile import ModelBillingProfileService, ModelBillingSource
from enums import CloudPlan, DeploymentEdition
from models.account import Tenant, TenantAccountJoin, TenantAccountRole
from models.tokener import TenantTokenerIntegrationStatus
from services.account_service import TenantService
from services.billing_service import BillingService, TokenerTenantMeteringResponse
from services.errors.billing import BillingError, LegacyCreditPoolManagedByTokenerError
from services.feature_service import FeatureService

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EffectiveCreditPool:
    model_billing_source: ModelBillingSource = ModelBillingSource.LEGACY_MESSAGE_CREDITS
    model_billing_migration_status: Literal["none", "preparing", "processing", "active"] = "none"
    tokener_bootstrap_status: str | None = None
    plan: CloudPlan | None = None
    pool_type: Literal["paid", "trial"] | None = None
    quota_limit: int | None = None
    quota_used: int | None = None
    exhausted_at: int | None = None
    next_credit_reset_date: int | None = None
    tokener_metering: TokenerTenantMeteringResponse | None = None

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
        if (
            self.model_billing_source == ModelBillingSource.TOKENER
            or self.model_billing_migration_status == "processing"
        ):
            return False
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
        """Read display credits without crossing an already claimed legacy fence."""
        from core.model_invocation_routing import migration_display_status

        migration_status = migration_display_status(tenant_id)
        model_billing = ModelBillingProfileService.resolve(tenant_id, session=session)
        display_source = (
            ModelBillingSource.TOKENER if migration_status == "active" else model_billing.model_billing_source
        )
        tokener_bootstrap_status = (
            model_billing.tokener_bootstrap_status.value if model_billing.tokener_bootstrap_status else None
        )
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
            return EffectiveCreditPool(
                model_billing_source=display_source,
                model_billing_migration_status=migration_status,
                tokener_bootstrap_status=tokener_bootstrap_status,
            )

        billing_info = BillingService.get_info(tenant_id, exclude_vector_space=True)
        subscription_plan = CloudPlan(billing_info["subscription"]["plan"])

        if migration_status in {"processing", "active"} or model_billing.uses_tokener:
            # Claim irrevocably fences legacy GetBalance before profile
            # publication. Null means unavailable/transitioning, never zero.
            # The authoritative active state also wins over a stale legacy cache.
            return EffectiveCreditPool(
                model_billing_source=display_source,
                model_billing_migration_status=migration_status,
                tokener_bootstrap_status=tokener_bootstrap_status,
                plan=subscription_plan,
                next_credit_reset_date=billing_info.get("next_credit_reset_date"),
            )

        return cls._read_legacy_display_pool(
            tenant_id,
            context=EffectiveCreditPool(
                model_billing_source=model_billing.model_billing_source,
                model_billing_migration_status=migration_status,
                tokener_bootstrap_status=tokener_bootstrap_status,
                plan=subscription_plan,
                next_credit_reset_date=billing_info.get("next_credit_reset_date"),
            ),
            session=session,
        )

    @classmethod
    def _read_legacy_display_pool(
        cls,
        tenant_id: str,
        *,
        context: EffectiveCreditPool,
        session: Session,
    ) -> EffectiveCreditPool:
        """Preserve the financial denial if trusted migration state cannot explain it."""
        from core.model_invocation_routing import migration_display_status
        from services.credit_pool_service import CreditPoolBalance, CreditPoolService

        effective_pool = None
        effective_pool_type: Literal["paid", "trial"] = "trial"
        try:
            if context.plan != CloudPlan.SANDBOX:
                paid_pool = CreditPoolService.get_pool(tenant_id=tenant_id, pool_type="paid", session=session)
                if paid_pool is not None and (
                    paid_pool.quota_limit == -1 or paid_pool.quota_limit > paid_pool.quota_used
                ):
                    effective_pool = paid_pool
                    effective_pool_type = "paid"
            if effective_pool is None:
                effective_pool = CreditPoolService.get_pool(tenant_id=tenant_id, pool_type="trial", session=session)
        except LegacyCreditPoolManagedByTokenerError:
            # Claim can win after the initial display-state read. Refresh Core
            # authority only for this exact fence; never mask another 409/outage
            # or consult local/stale legacy balances as a fallback.
            current_status = migration_display_status(tenant_id)
            if current_status not in {"processing", "active"}:
                raise
            return replace(
                context,
                model_billing_migration_status=current_status,
                model_billing_source=ModelBillingSource.TOKENER
                if current_status == "active"
                else context.model_billing_source,
            )
        if effective_pool is None:
            return context

        exhausted_at = effective_pool.exhausted_at if isinstance(effective_pool, CreditPoolBalance) else None
        if not (
            isinstance(exhausted_at, int)
            and exhausted_at > 0
            and effective_pool.quota_limit > 0
            and effective_pool.quota_used >= effective_pool.quota_limit
        ):
            exhausted_at = None

        return replace(
            context,
            pool_type=effective_pool_type,
            quota_limit=effective_pool.quota_limit,
            quota_used=effective_pool.quota_used,
            exhausted_at=exhausted_at,
        )

    @classmethod
    def get_model_provider_credits(cls, tenant_id: str, *, session: Session) -> EffectiveCreditPool:
        """Return legacy credits or enrich a ready Tokener cohort with metering usage."""
        from core.model_invocation_routing import migration_display_status

        migration_status = migration_display_status(tenant_id)
        if migration_status == "processing":
            # No old-credit zero/remaining value masquerading as the new wallet.
            return EffectiveCreditPool(model_billing_migration_status="processing")
        credit_pool = cls.get_effective_credit_pool(tenant_id, session=session)
        # The nested read may observe a later claim/activation. Never overwrite
        # that newer authority with the initial display snapshot.
        if (
            dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD
            or credit_pool.model_billing_migration_status == "processing"
            or credit_pool.model_billing_source != ModelBillingSource.TOKENER
            or credit_pool.tokener_bootstrap_status != TenantTokenerIntegrationStatus.READY.value
        ):
            return credit_pool

        try:
            tokener_metering = BillingService.get_tokener_metering(tenant_id)
        except BillingError:
            logger.warning("Tokener metering usage is unavailable for tenant %s", tenant_id)
            return credit_pool
        return replace(credit_pool, tokener_metering=tokener_metering)

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
            "model_billing_source": effective_pool.model_billing_source.value,
            "model_billing_migration_status": effective_pool.model_billing_migration_status,
            "tokener_bootstrap_status": effective_pool.tokener_bootstrap_status,
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
        tenant_info["plan"] = (
            feature.billing.subscription.plan if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD else None
        )
        model_billing = ModelBillingProfileService.resolve(tenant.id, session=session)
        migration_status = feature.model_billing_migration_status
        tenant_info["model_billing_source"] = (
            ModelBillingSource.TOKENER.value
            if migration_status == "active"
            else model_billing.model_billing_source.value
        )
        tenant_info["model_billing_migration_status"] = migration_status
        tenant_info["tokener_bootstrap_status"] = (
            model_billing.tokener_bootstrap_status.value if model_billing.tokener_bootstrap_status else None
        )
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
        if (
            dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD
            and model_billing.uses_legacy_message_credits
            and migration_status not in {"processing", "active"}
        ):
            pool = cls._read_legacy_display_pool(
                tenant.id,
                session=session,
                context=EffectiveCreditPool(
                    model_billing_source=model_billing.model_billing_source,
                    model_billing_migration_status=migration_status,
                    plan=feature.billing.subscription.plan,
                    next_credit_reset_date=feature.next_credit_reset_date,
                ),
            )
            tenant_info["model_billing_migration_status"] = pool.model_billing_migration_status
            tenant_info["model_billing_source"] = pool.model_billing_source.value
            if pool.model_billing_migration_status not in {"processing", "active"}:
                tenant_info["next_credit_reset_date"] = pool.next_credit_reset_date
            if pool.quota_limit is not None and pool.quota_used is not None:
                _set_credit_pool_info(
                    tenant_info,
                    quota_limit=pool.quota_limit,
                    quota_used=pool.quota_used,
                    exhausted_at=pool.exhausted_at,
                )

        return tenant_info
