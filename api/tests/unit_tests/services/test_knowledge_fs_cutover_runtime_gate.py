from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs_cutover import (
    KnowledgeFSCutoverRevisionWatermark,
    KnowledgeFSWorkspaceCutoverLedger,
    KnowledgeFSWorkspaceCutoverPhase,
)
from services.knowledge_fs.cutover_runtime_gate import SQLKnowledgeFSWorkspaceRuntimeGate
from services.knowledge_fs.product_remote import KnowledgeFSOperationUnavailableError

_WATERMARK: KnowledgeFSCutoverRevisionWatermark = {
    "membership_epoch": 1,
    "space_acl_epoch": 1,
    "external_access_epoch": 1,
    "content_policy_revision": 1,
}


@pytest.mark.parametrize("sqlite_session", [(KnowledgeFSWorkspaceCutoverLedger,)], indirect=True)
def test_runtime_gate_fails_closed_without_a_cutover_ledger(sqlite_session: Session) -> None:
    gate = SQLKnowledgeFSWorkspaceRuntimeGate(sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False))

    with pytest.raises(KnowledgeFSOperationUnavailableError, match="not cut over"):
        gate.require_product_routes(tenant_id="tenant-1")

    with pytest.raises(KnowledgeFSOperationUnavailableError, match="not cut over"):
        gate.require_capability_v2(tenant_id="tenant-1")


@pytest.mark.parametrize("sqlite_session", [(KnowledgeFSWorkspaceCutoverLedger,)], indirect=True)
def test_runtime_gate_requires_the_complete_atomic_cutover_state(sqlite_session: Session) -> None:
    ledger = KnowledgeFSWorkspaceCutoverLedger(
        tenant_id="tenant-1",
        source_revision_watermark=_WATERMARK,
        applied_revision_watermark=_WATERMARK,
        phase=KnowledgeFSWorkspaceCutoverPhase.CUTOVER,
        freeze_at=datetime(2026, 7, 21, 11, 59, tzinfo=UTC),
        cutover_at=datetime(2026, 7, 21, 12, 0, tzinfo=UTC),
        product_routes_enabled=True,
        capability_v2_enabled=True,
        integrated_mode_enabled=True,
        legacy_acl_read_only=False,
    )
    sqlite_session.add(ledger)
    sqlite_session.commit()
    gate = SQLKnowledgeFSWorkspaceRuntimeGate(sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False))

    with pytest.raises(KnowledgeFSOperationUnavailableError, match="not cut over"):
        gate.require_product_routes(tenant_id="tenant-1")

    ledger.legacy_acl_read_only = True
    sqlite_session.commit()

    gate.require_product_routes(tenant_id="tenant-1")
    gate.require_capability_v2(tenant_id="tenant-1")


@pytest.mark.parametrize("sqlite_session", [(KnowledgeFSWorkspaceCutoverLedger,)], indirect=True)
def test_runtime_gate_stops_product_traffic_after_a_safe_rollback(sqlite_session: Session) -> None:
    sqlite_session.add(
        KnowledgeFSWorkspaceCutoverLedger(
            tenant_id="tenant-1",
            source_revision_watermark=_WATERMARK,
            applied_revision_watermark=_WATERMARK,
            phase=KnowledgeFSWorkspaceCutoverPhase.FROZEN,
            freeze_at=datetime(2026, 7, 21, 11, 59, tzinfo=UTC),
            cutover_at=datetime(2026, 7, 21, 12, 0, tzinfo=UTC),
            rolled_back_at=datetime(2026, 7, 21, 13, 0, tzinfo=UTC),
            product_routes_enabled=False,
            capability_v2_enabled=True,
            integrated_mode_enabled=True,
            legacy_acl_read_only=True,
        )
    )
    sqlite_session.commit()
    gate = SQLKnowledgeFSWorkspaceRuntimeGate(sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False))

    with pytest.raises(KnowledgeFSOperationUnavailableError, match="not cut over"):
        gate.require_product_routes(tenant_id="tenant-1")

    with pytest.raises(KnowledgeFSOperationUnavailableError, match="not cut over"):
        gate.require_capability_v2(tenant_id="tenant-1")


@pytest.mark.parametrize("sqlite_session", [(KnowledgeFSWorkspaceCutoverLedger,)], indirect=True)
def test_runtime_gate_rejects_inconsistent_rolled_back_traffic_flags(sqlite_session: Session) -> None:
    sqlite_session.add(
        KnowledgeFSWorkspaceCutoverLedger(
            tenant_id="tenant-1",
            source_revision_watermark=_WATERMARK,
            applied_revision_watermark=_WATERMARK,
            phase=KnowledgeFSWorkspaceCutoverPhase.CUTOVER,
            freeze_at=datetime(2026, 7, 21, 11, 59, tzinfo=UTC),
            cutover_at=datetime(2026, 7, 21, 12, 0, tzinfo=UTC),
            rolled_back_at=datetime(2026, 7, 21, 13, 0, tzinfo=UTC),
            product_routes_enabled=True,
            capability_v2_enabled=True,
            integrated_mode_enabled=True,
            legacy_acl_read_only=True,
        )
    )
    sqlite_session.commit()
    gate = SQLKnowledgeFSWorkspaceRuntimeGate(sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False))

    with pytest.raises(KnowledgeFSOperationUnavailableError, match="not cut over"):
        gate.require_product_routes(tenant_id="tenant-1")
