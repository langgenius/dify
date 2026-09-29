"""Tenant-scoped admission reads, independent from migration orchestration."""

from typing import Any

from sqlalchemy import select

from core.db.session_factory import session_factory
from models.model_billing_migration import TenantModelBillingMigration


def get_routing_state(tenant_id: str) -> dict[str, Any] | None:
    """Read only the narrow admission projection, never the control journal.

    PostgreSQL stores the new table's state as JSONB. Extracting these fields
    avoids fetching/deserializing manifests, operations, and receipt history
    on every model invocation. SQLite uses the JSON variant for unit tests.
    """
    with session_factory.create_session() as session:
        model = TenantModelBillingMigration
        row = (
            session.execute(
                select(
                    model.tenant_id,
                    model.migration_id,
                    model.phase,
                    model.route_epoch,
                    model.claimed_at,
                    model.state["blocked_from"].as_string().label("blocked_from"),
                    model.state["model_mapping_version"].as_string().label("model_mapping_version"),
                    model.state["preparation"].label("preparation"),
                    model.state["provisioned_binding"].label("provisioned_binding"),
                    model.state["source_ownership"].label("source_ownership"),
                    model.state["ever_activated"].as_boolean().label("ever_activated"),
                ).where(model.tenant_id == tenant_id)
            )
            .mappings()
            .one_or_none()
        )
        if row is None:
            return None
        result = {str(key): value for key, value in row.items()}
        result["preparation"] = result["preparation"] or {}
        result["provisioned_binding"] = result["provisioned_binding"] or {}
        result["source_ownership"] = result["source_ownership"] or {}
        result["ever_activated"] = bool(result["ever_activated"])
        if result["claimed_at"] is not None:
            result["claimed_at"] = result["claimed_at"].replace(microsecond=0).isoformat() + "Z"
        return result
