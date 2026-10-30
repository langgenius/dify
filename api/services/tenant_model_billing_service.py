"""Initialize managed-model billing for a newly created workspace."""

from sqlalchemy.orm import Session

from configs import dify_config
from models import TenantCreditPool
from models.enums import ProviderQuotaType
from models.model_billing import TenantModelBillingProfile
from models.tokener import TenantTokenerIntegration


def initialize_tenant_model_billing(tenant_id: str, *, session: Session) -> None:
    """Stage a new tenant's billing records in the caller-owned transaction.

    Call once while creating the tenant, before its creation event is emitted.
    This is not a migration or repair entrypoint for existing tenants. The
    caller owns commit/rollback; asynchronous Tokener provisioning starts only
    after the tenant and its explicit billing profile have been committed.
    """
    if dify_config.TOKENER_NEW_TENANT_COHORT_ENABLED:
        session.add_all(
            [
                TenantModelBillingProfile(tenant_id=tenant_id, model_billing_source="tokener"),
                TenantTokenerIntegration(
                    tenant_id=tenant_id,
                    plugin_unique_identifier=dify_config.TOKENER_PLUGIN_UNIQUE_IDENTIFIER.strip() or None,
                ),
            ]
        )
        return

    session.add(
        TenantCreditPool(
            tenant_id=tenant_id,
            quota_limit=dify_config.HOSTED_POOL_CREDITS,
            quota_used=0,
            pool_type=ProviderQuotaType.TRIAL,
        )
    )
