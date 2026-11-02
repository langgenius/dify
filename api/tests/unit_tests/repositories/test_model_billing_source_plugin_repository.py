"""Actual SQLite publication projection stays owner scoped and read only."""

from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.account import Tenant
from models.model_billing import TenantModelBillingProfile
from models.model_billing_migration import TenantModelBillingMigration
from repositories.model_billing_source_plugin_repository import ModelBillingSourcePluginRepository
from services.model_billing_source_plugin_admission import SourcePluginAdmissionError


@pytest.mark.parametrize("profile", [None, "tokener"])
@pytest.mark.parametrize(
    ("phase", "ever"),
    [
        ("preparing", False),
        ("prepared", False),
        ("claimed", False),
        ("granting", False),
        ("activating", False),
        ("blocked", False),
        ("active", True),
        ("cancelled", False),
        ("cancelled", True),
        ("blocked", True),
    ],
)
def test_publication_not_phase_or_other_tenant_controls_protection(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], profile: str | None, phase: str, ever: bool
) -> None:
    tenant, other = Tenant(name="source admission"), Tenant(name="unrelated")
    sqlite_session.add_all([tenant, other])
    sqlite_session.flush()
    row = TenantModelBillingMigration(
        tenant_id=tenant.id,
        migration_id=str(uuid4()),
        batch_id="admission",
        phase=phase,
        route_epoch=1,
        state={"ever_activated": ever, "model_mapping_version": "frozen-v1", "journal": "not projected"},
    )
    sqlite_session.add_all(
        [
            row,
            TenantModelBillingProfile(tenant_id=tenant.id, model_billing_source=profile),
            TenantModelBillingProfile(tenant_id=other.id, model_billing_source="tokener"),
        ]
    )
    sqlite_session.commit()
    target = ModelBillingSourcePluginRepository(session_factory=sqlite_session_factory)
    protected = phase == "active" or ever
    frozen = not protected and phase != "cancelled"
    if protected and profile != "tokener":
        with pytest.raises(SourcePluginAdmissionError, match="route_state_invalid"):
            target.get_protection(tenant.id)
    else:
        result = target.get_protection(tenant.id)
        assert (result is not None) == (protected or frozen)
        if result is not None:
            assert result.tenant_id == tenant.id
            assert result.mapping_revision == "frozen-v1"
            assert result.route_epoch == 1
            assert result.pre_migration_freeze == frozen
    assert target.get_protection(other.id) is None
    sqlite_session.refresh(row)
    assert row.phase == phase
    assert row.route_epoch == 1
    assert row.state["journal"] == "not projected"


def test_cancelled_claimed_migration_cannot_release_source_freeze(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    tenant = Tenant(name="claimed cancellation")
    sqlite_session.add(tenant)
    sqlite_session.flush()
    sqlite_session.add(
        TenantModelBillingMigration(
            tenant_id=tenant.id,
            migration_id=str(uuid4()),
            batch_id="frozen",
            phase="cancelled",
            claimed_at=datetime(2026, 11, 2),
            route_epoch=1,
            state={"model_mapping_version": "frozen-v1", "ever_activated": False},
        )
    )
    sqlite_session.commit()
    result = ModelBillingSourcePluginRepository(session_factory=sqlite_session_factory).get_protection(tenant.id)
    assert result is not None
    assert result.pre_migration_freeze
