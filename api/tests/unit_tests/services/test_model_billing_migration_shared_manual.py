"""Execute the exact Go-produced manual-replan request against real Core state."""

import json
from datetime import datetime
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from models.account import Tenant
from models.model_billing_migration import TenantModelBillingMigration
from services import model_billing_migration_service as module
from services.entities.model_billing_migration import ContractEventPayload, canonical_hash
from services.model_billing_migration_service import ModelBillingMigrationService

FIXTURES = Path(__file__).resolve().parents[3] / "contracts/fixtures"


def test_go_manual_fixture_is_accepted_by_actual_core_cas(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    manifest = json.loads((FIXTURES / "tokener_migration_manifest_v1.json").read_text())
    request = json.loads((FIXTURES / "tokener_manual_replan_v1.json").read_text())
    tenant = Tenant(name="Shared Go/Core manual repair")
    tenant.id = manifest["tenant_id"]
    sqlite_session.add(tenant)
    original_hash = canonical_hash(manifest)
    decisions = {
        window["cycle_key"]: {
            "cycle_key": window["cycle_key"],
            "decision": "tokener",
            "contract_ref": manifest["contract_ref"],
            "operation_id": "33333333-3333-4333-8333-333333333333",
            "manifest_hash": original_hash,
        }
        for window in manifest["windows"]
    }
    sqlite_session.add(
        TenantModelBillingMigration(
            tenant_id=tenant.id,
            migration_id=manifest["migration_id"],
            batch_id="shared-fixture",
            phase="claimed",
            revision=7,
            route_epoch=1,
            claimed_at=datetime(2027, 6, 17, 12),
            state={
                "manifest": manifest,
                "manifest_hash": original_hash,
                "intent_revision": 1,
                "model_mapping_version": manifest["model_mapping_version"],
                "inventory_hash": "sha256:" + "1" * 64,
                "commands": {},
                "cycle_decisions": decisions,
            },
        )
    )
    sqlite_session.commit()
    monkeypatch.setattr(module, "naive_utc_now", lambda: datetime(2027, 6, 18, 12))
    result = ModelBillingMigrationService.contract_event(
        tenant.id,
        manifest["migration_id"],
        ContractEventPayload.model_validate(request),
    )
    assert result["revision"] == 8
    assert result["phase"] == "blocked"
    assert result["manifest"] == request["replacement_manifest"]
    assert result["manifest_hash"] == request["replacement_manifest_hash"]
    assert result["claimed_at"] == "2027-06-17T12:00:00Z"
    assert {decision["manifest_hash"] for decision in result["cycle_decisions"]} == {original_hash}
    replayed = ModelBillingMigrationService.contract_event(
        tenant.id,
        manifest["migration_id"],
        ContractEventPayload.model_validate(request),
    )
    assert replayed["replayed"] is True
    assert replayed["replayed_operation"]["result_revision"] == 8
