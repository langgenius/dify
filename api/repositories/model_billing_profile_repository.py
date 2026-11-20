"""Tenant-scoped, bounded native-cohort read adapter."""

from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.model_billing import TenantModelBillingProfile
from models.tokener import TenantTokenerIntegration
from services.entities.model_billing import StoredModelBillingProfile


class ModelBillingProfileRepository:
    def __init__(self, *, sessions: Callable[[], Session]) -> None:
        self._sessions = sessions

    def get(self, tenant_id: str) -> StoredModelBillingProfile | None:
        """Project one owned profile/status and close its session before external work."""
        with self._sessions() as session:
            row = session.execute(
                select(TenantModelBillingProfile.model_billing_source, TenantTokenerIntegration.status)
                .outerjoin(
                    TenantTokenerIntegration,
                    TenantTokenerIntegration.tenant_id == TenantModelBillingProfile.tenant_id,
                )
                .where(TenantModelBillingProfile.tenant_id == tenant_id)
            ).one_or_none()
            return StoredModelBillingProfile(row.model_billing_source, row.status) if row is not None else None
