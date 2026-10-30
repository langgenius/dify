"""Claim a legacy free workspace's one-time funding intent.

Billing owns subscription eligibility, trial configuration and remote readback.
This application slice accepts only an admitted internal caller and a frozen,
tenant-bound grant. The store arbitrates paid/free contenders atomically using
the same migration row, operation replay, row lock and CAS as paid migration.
No wallet balance, source credential or App configuration is projected here.
"""

from dataclasses import dataclass
from typing import Any, Protocol

from core.model_billing_migration_protocol import canonical_hash
from services.entities.model_billing_migration import ClaimFreeMigrationPayload


@dataclass(frozen=True, slots=True)
class AdmittedBillingMigrationCaller:
    """Tenant scope constructed by the transport only after internal admission."""

    tenant_id: str


class FreeMigrationError(Exception):
    """Secret-free application error; transport owns its HTTP representation."""

    def __init__(self, code: str, *, retryable: bool = False) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable


class FreeMigrationStore(Protocol):
    def claim_free(self, tenant_id: str, migration_id: str, payload: ClaimFreeMigrationPayload) -> dict[str, Any]:
        """Atomically claim the prepared tenant migration or replay its operation.

        The adapter owns one bounded transaction and the tenant migration row
        FOR UPDATE lock. It verifies migration identity, replays before CAS,
        checks admission/free preparation/readiness/batch pause, and freezes
        the manifest before moving prepared -> claimed. Paid and free use the
        same row, so only one same-revision contender succeeds. No remote I/O
        occurs in the transaction. Return detached control-state values, never
        sessions or ORM rows. Raise FreeMigrationError on conflict/missing state.
        """
        ...


def validate_free_claim_identity(tenant_id: str, migration_id: str, payload: ClaimFreeMigrationPayload) -> None:
    """Pure identity/hash invariant also reused by the atomic write adapter."""
    manifest = payload.free_grant_manifest
    if (
        manifest.tenant_id != tenant_id
        or manifest.migration_id != migration_id
        or canonical_hash(manifest.model_dump(mode="json")) != payload.manifest_hash
    ):
        raise FreeMigrationError("manifest_conflict")


class ModelBillingFreeMigrationService:
    def __init__(self, *, store: FreeMigrationStore) -> None:
        self._store = store

    def claim_free(
        self,
        caller: AdmittedBillingMigrationCaller,
        migration_id: str,
        payload: ClaimFreeMigrationPayload,
    ) -> dict[str, Any]:
        validate_free_claim_identity(caller.tenant_id, migration_id, payload)
        return self._store.claim_free(caller.tenant_id, migration_id, payload)
