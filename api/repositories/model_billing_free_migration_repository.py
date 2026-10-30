"""Legacy-owner adapter for the new free migration application port.

Reuse the existing migration transaction/replay owner and readiness checks, not
a second row or independent balance store. Sessions remain inside the adapter.
"""

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from models.model_billing_migration import TenantModelBillingMigration
from services.entities.model_billing_migration import ClaimFreeMigrationPayload
from services.model_billing_free_migration_service import FreeMigrationError, validate_free_claim_identity
from services.model_billing_migration_service import MigrationError, ModelBillingMigrationService


class ModelBillingFreeMigrationRepository:
    def claim_free(self, tenant_id: str, migration_id: str, payload: ClaimFreeMigrationPayload) -> dict[str, Any]:
        def action(session: Session, row: TenantModelBillingMigration, now: datetime) -> None:
            validate_free_claim_identity(tenant_id, migration_id, payload)
            ModelBillingMigrationService.assert_claim_readiness(session, row, now, payload.preparation_binding_hash)
            if row.state.get("eligibility_policy_version") != "free-legacy-v1":
                raise MigrationError("ineligible_contract", 422)
            manifest = payload.free_grant_manifest
            if manifest.model_mapping_version != row.state["model_mapping_version"]:
                raise MigrationError("manifest_conflict")
            if "manifest" in row.state or "free_grant_manifest" in row.state:
                raise MigrationError("manifest_conflict")
            row.state.update(
                free_grant_manifest=manifest.model_dump(mode="json"),
                manifest_hash=payload.manifest_hash,
                intent_revision=1,
                billing_receipt_refs=list(payload.billing_receipt_refs),
                commands={},
            )
            row.phase = "claimed"
            row.claimed_at = now
            row.route_epoch += 1

        try:
            return ModelBillingMigrationService._mutate(tenant_id, migration_id, payload, action)
        except MigrationError as error:
            raise FreeMigrationError(error.code, retryable=error.retryable) from error
