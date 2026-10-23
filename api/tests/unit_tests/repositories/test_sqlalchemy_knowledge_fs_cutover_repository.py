from __future__ import annotations

from dataclasses import replace
from datetime import datetime

import pytest
from sqlalchemy.orm import Session

from models.knowledge_fs_cutover import (
    KnowledgeFSMigrationIssueStatus,
    KnowledgeFSMigrationQuarantine,
    KnowledgeFSMigrationQuarantineDisposition,
    KnowledgeFSMigrationQuarantineKind,
    KnowledgeFSShadowAuthorizationDecision,
    KnowledgeFSShadowAuthorizationDiff,
    KnowledgeFSShadowAuthorizationObservation,
    KnowledgeFSWorkspaceCutoverLedger,
    KnowledgeFSWorkspaceCutoverPhase,
)
from repositories.knowledge_fs_cutover_repository import (
    KnowledgeFSCutoverCASUpdate,
    KnowledgeFSQuarantineCASUpdate,
    KnowledgeFSShadowDiffCASUpdate,
)
from repositories.sqlalchemy_knowledge_fs_cutover_repository import SQLAlchemyKnowledgeFSCutoverRepository

_WATERMARK = {
    "membership_epoch": 1,
    "space_acl_epoch": 2,
    "external_access_epoch": 3,
    "content_policy_revision": 4,
}


@pytest.mark.parametrize("sqlite_session", [(KnowledgeFSWorkspaceCutoverLedger,)], indirect=True)
def test_compare_and_set_is_tenant_phase_and_version_scoped(sqlite_session: Session) -> None:
    repository = SQLAlchemyKnowledgeFSCutoverRepository(sqlite_session)
    repository.add_ledger(
        KnowledgeFSWorkspaceCutoverLedger(
            tenant_id="tenant-1",
            source_revision_watermark=_WATERMARK,
            applied_revision_watermark=_WATERMARK,
        )
    )
    update = KnowledgeFSCutoverCASUpdate(
        tenant_id="tenant-1",
        expected_phase=KnowledgeFSWorkspaceCutoverPhase.INVENTORY,
        expected_cas_version=0,
        new_phase=KnowledgeFSWorkspaceCutoverPhase.CUTOVER,
        product_routes_enabled=True,
        capability_v2_enabled=True,
        integrated_mode_enabled=True,
        legacy_acl_read_only=True,
        remote_activation_id=f"sha256:{'a' * 64}",
        remote_activation_revision=1,
        remote_activation_digest=f"sha256:{'b' * 64}",
        remote_activation_control_space_id="control-1",
        remote_activation_activated_at=datetime(2026, 7, 21, 12, 0),
        remote_activation_updated_at=datetime(2026, 7, 21, 12, 0),
        remote_activation_acknowledged_at=datetime(2026, 7, 21, 12, 1),
        remote_activation_applied=True,
        remote_activation_replayed=False,
    )

    assert repository.compare_and_set(update) is True
    assert repository.compare_and_set(update) is False
    sqlite_session.commit()

    ledger = repository.get_ledger(tenant_id="tenant-1")
    assert ledger is not None
    assert ledger.cas_version == 1
    assert ledger.phase is KnowledgeFSWorkspaceCutoverPhase.CUTOVER
    assert ledger.product_routes_enabled is True
    assert ledger.capability_v2_enabled is True
    assert ledger.integrated_mode_enabled is True
    assert ledger.legacy_acl_read_only is True
    assert ledger.remote_activation_id == f"sha256:{'a' * 64}"
    assert ledger.remote_activation_revision == 1
    assert ledger.remote_activation_digest == f"sha256:{'b' * 64}"
    assert ledger.remote_activation_control_space_id == "control-1"
    assert ledger.remote_activation_applied is True
    assert ledger.remote_activation_replayed is False


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSWorkspaceCutoverLedger, KnowledgeFSMigrationQuarantine)],
    indirect=True,
)
def test_quarantine_compare_and_set_is_tenant_item_disposition_and_version_scoped(
    sqlite_session: Session,
) -> None:
    repository = SQLAlchemyKnowledgeFSCutoverRepository(sqlite_session)
    ledger = repository.add_ledger(
        KnowledgeFSWorkspaceCutoverLedger(
            tenant_id="tenant-1",
            source_revision_watermark=_WATERMARK,
            applied_revision_watermark=_WATERMARK,
        )
    )
    repository.add_quarantine(
        KnowledgeFSMigrationQuarantine(
            tenant_id="tenant-1",
            ledger_id=ledger.id,
            source_kind=KnowledgeFSMigrationQuarantineKind.LEGACY_API_KEY,
            source_id="key-1",
            reason_code="ROTATION_REQUIRED",
            disposition=KnowledgeFSMigrationQuarantineDisposition.ROTATE_CREDENTIAL,
            details={"prefix": "kfs_", "last4": "1234"},
        )
    )
    resolution = KnowledgeFSQuarantineCASUpdate(
        tenant_id="tenant-1",
        ledger_id=ledger.id,
        source_kind=KnowledgeFSMigrationQuarantineKind.LEGACY_API_KEY,
        source_id="key-1",
        expected_disposition=KnowledgeFSMigrationQuarantineDisposition.ROTATE_CREDENTIAL,
        expected_row_version=0,
        resolved_by_operator="migration-oncall",
        resolved_by_account_id="account-1",
        evidence={"reference": "change://key-rotation/1"},
        resolved_at=datetime(2026, 7, 21, 12, 0),
    )

    assert repository.resolve_quarantine(resolution) is True
    assert repository.resolve_quarantine(resolution) is False
    assert repository.resolve_quarantine(replace(resolution, tenant_id="tenant-2")) is False
    sqlite_session.commit()

    item = repository.get_quarantine(
        tenant_id="tenant-1",
        ledger_id=ledger.id,
        source_kind=KnowledgeFSMigrationQuarantineKind.LEGACY_API_KEY,
        source_id="key-1",
    )
    assert item is not None
    assert item.disposition is KnowledgeFSMigrationQuarantineDisposition.RESOLVED
    assert item.resolved_by_operator == "migration-oncall"
    assert item.resolved_by_account_id == "account-1"
    assert item.evidence == {"reference": "change://key-rotation/1"}
    assert item.row_version == 1


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSWorkspaceCutoverLedger,
            KnowledgeFSShadowAuthorizationDiff,
            KnowledgeFSShadowAuthorizationObservation,
        )
    ],
    indirect=True,
)
def test_shadow_observations_are_append_only_and_diff_reevaluation_is_version_scoped(
    sqlite_session: Session,
) -> None:
    repository = SQLAlchemyKnowledgeFSCutoverRepository(sqlite_session)
    ledger = repository.add_ledger(
        KnowledgeFSWorkspaceCutoverLedger(
            tenant_id="tenant-1",
            source_revision_watermark=_WATERMARK,
            applied_revision_watermark=_WATERMARK,
        )
    )
    observed_at = datetime(2026, 7, 21, 12, 0)
    repository.add_shadow_observation(
        KnowledgeFSShadowAuthorizationObservation(
            tenant_id="tenant-1",
            ledger_id=ledger.id,
            diff_key="diff-1",
            producer="dify-shadow-authorizer",
            principal="principal-1",
            legacy_allowed=False,
            dify_allowed=True,
            decision=KnowledgeFSShadowAuthorizationDecision.EXPANDED,
            reason="expanded",
            observed_revision=_WATERMARK,
            observed_at=observed_at,
            evidence_digest=f"sha256:{'a' * 64}",
        )
    )
    repository.add_shadow_diff(
        KnowledgeFSShadowAuthorizationDiff(
            tenant_id="tenant-1",
            ledger_id=ledger.id,
            diff_key="diff-1",
            principal="principal-1",
            legacy_allowed=False,
            dify_allowed=True,
            decision=KnowledgeFSShadowAuthorizationDecision.EXPANDED,
            reason="expanded",
            observed_revision=_WATERMARK,
            status=KnowledgeFSMigrationIssueStatus.OPEN,
            current_evidence_digest=f"sha256:{'a' * 64}",
            last_observed_at=observed_at,
        )
    )
    update_values = KnowledgeFSShadowDiffCASUpdate(
        tenant_id="tenant-1",
        ledger_id=ledger.id,
        diff_key="diff-1",
        expected_row_version=0,
        control_space_id=None,
        principal="principal-1",
        legacy_allowed=False,
        dify_allowed=False,
        decision=KnowledgeFSShadowAuthorizationDecision.MATCH,
        reason="remediated",
        observed_revision=_WATERMARK,
        status=KnowledgeFSMigrationIssueStatus.RESOLVED,
        current_evidence_digest=f"sha256:{'b' * 64}",
        last_observed_at=observed_at,
    )

    assert repository.reevaluate_shadow_diff(replace(update_values, tenant_id="tenant-2")) is False
    assert repository.reevaluate_shadow_diff(update_values) is True
    assert repository.reevaluate_shadow_diff(update_values) is False
    observations = repository.list_shadow_observations(tenant_id="tenant-1", ledger_id=ledger.id)
    assert len(observations) == 1
    assert observations[0].evidence_digest == f"sha256:{'a' * 64}"
    diff = repository.get_shadow_diff(tenant_id="tenant-1", ledger_id=ledger.id, diff_key="diff-1")
    assert diff is not None
    assert diff.decision is KnowledgeFSShadowAuthorizationDecision.MATCH
    assert diff.status is KnowledgeFSMigrationIssueStatus.RESOLVED
    assert diff.row_version == 1
