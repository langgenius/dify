"""Owner-scoped publication facts for source plugin mutation admission."""

import re

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.model_billing import TenantModelBillingProfile
from models.model_billing_migration import TenantModelBillingMigration
from services.model_billing_source_plugin_admission import SourcePluginAdmissionError, SourcePluginProtection


class ModelBillingSourcePluginRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def get_protection(self, tenant_id: str) -> SourcePluginProtection | None:
        model = TenantModelBillingMigration
        with self._session_factory() as session:
            row = (
                session.execute(
                    select(
                        model.phase,
                        model.route_epoch,
                        model.claimed_at,
                        model.state["ever_activated"].as_boolean().label("ever_activated"),
                        model.state["model_mapping_version"].as_string().label("mapping_revision"),
                        model.state["source_ownership"].label("source_ownership"),
                        TenantModelBillingProfile.model_billing_source.label("billing_source"),
                    )
                    .outerjoin(TenantModelBillingProfile, TenantModelBillingProfile.tenant_id == model.tenant_id)
                    .where(model.tenant_id == tenant_id)
                )
                .mappings()
                .one_or_none()
            )
        if row is None:
            return None
        if row["phase"] != "active" and row["ever_activated"] is not True:
            if row["phase"] == "cancelled" and row["claimed_at"] is None:
                return None
            return SourcePluginProtection(
                tenant_id, row["mapping_revision"] or "", row["route_epoch"], pre_migration_freeze=True
            )
        if row["billing_source"] != "tokener" or not row["mapping_revision"] or row["route_epoch"] <= 0:
            raise SourcePluginAdmissionError("source_plugin_route_state_invalid")
        ownership = row["source_ownership"]
        plugins = None
        if ownership is not None and not isinstance(ownership, dict):
            raise SourcePluginAdmissionError("source_plugin_route_state_invalid")
        if isinstance(ownership, dict):
            if any(
                not isinstance(provider, str) or not re.fullmatch(r"[a-z0-9_-]+/[a-z0-9_-]+/[a-z0-9_-]+", provider)
                for provider in ownership
            ):
                raise SourcePluginAdmissionError("source_plugin_route_state_invalid")
            plugins = tuple(sorted({provider.rsplit("/", 1)[0] for provider in ownership}))
        return SourcePluginProtection(tenant_id, row["mapping_revision"], row["route_epoch"], plugins)
