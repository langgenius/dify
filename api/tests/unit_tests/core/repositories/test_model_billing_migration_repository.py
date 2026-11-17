from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from core.repositories.model_billing_migration_repository import get_routing_state
from models.account import Tenant
from models.model_billing import TenantModelBillingProfile
from models.model_billing_migration import TenantModelBillingMigration
from services.model_billing_mapping_service import uses_published_tokener_balance


@pytest.mark.parametrize("profile", ["missing", "legacy_null", "tokener"])
@pytest.mark.parametrize(
    ("phase", "ever_activated"),
    [
        ("preparing", False),
        ("claimed", False),
        ("active", True),
        ("cancelled", False),
        ("cancelled", True),
        ("blocked", True),
    ],
)
def test_projection_uses_actual_tenant_profile_not_phase_or_other_workspace(
    sqlite_session: Session, profile: str, phase: str, ever_activated: bool
) -> None:
    tenant, other = Tenant(name="Routing scope"), Tenant(name="Other workspace")
    sqlite_session.add_all([tenant, other])
    sqlite_session.flush()
    row = TenantModelBillingMigration(
        tenant_id=tenant.id,
        migration_id=str(uuid4()),
        batch_id="profile-proof",
        phase=phase,
        route_epoch=3,
        claimed_at=datetime(2026, 10, 1),
        state={
            "ever_activated": ever_activated,
            "model_mapping_version": "frozen-v1",
            "large_control_journal": "not projected",
        },
    )
    sqlite_session.add(row)
    sqlite_session.add(TenantModelBillingProfile(tenant_id=other.id, model_billing_source="tokener"))
    if profile != "missing":
        sqlite_session.add(
            TenantModelBillingProfile(
                tenant_id=tenant.id, model_billing_source="tokener" if profile == "tokener" else None
            )
        )
    sqlite_session.commit()
    state = get_routing_state(tenant.id)
    assert state is not None
    assert state["persisted_model_billing_source"] == ("tokener" if profile == "tokener" else None)
    assert "large_control_journal" not in state
    assert uses_published_tokener_balance(state) is (
        profile == "tokener" and (phase == "active" or phase == "cancelled" and ever_activated)
    )
    assert get_routing_state(other.id) is None
    sqlite_session.refresh(row)
    assert row.phase == phase
    assert row.route_epoch == 3
    assert row.state == {
        "ever_activated": ever_activated,
        "model_mapping_version": "frozen-v1",
        "large_control_journal": "not projected",
    }
