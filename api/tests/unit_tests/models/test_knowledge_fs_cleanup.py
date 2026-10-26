from __future__ import annotations

from models.knowledge_fs_cleanup import (
    KnowledgeFSCleanupAuthorization,
    KnowledgeFSCleanupAuthorizationStatus,
    KnowledgeFSCleanupTarget,
)
from models.knowledge_fs_cutover import KnowledgeFSWorkspaceCutoverLedger


def test_cleanup_authorization_is_versioned_four_eyes_audit_state() -> None:
    assert [status.value for status in KnowledgeFSCleanupAuthorizationStatus] == [
        "requested",
        "approved",
        "started",
        "completed",
    ]
    assert {target.value for target in KnowledgeFSCleanupTarget} == {
        "legacy_snapshot_foreign_keys",
        "legacy_acl_routes",
        "legacy_acl_schema",
        "legacy_api_key_schema",
        "legacy_v1_auth",
        "raw_list_create_proxy",
    }
    assert {
        "readiness_evidence",
        "requested_by_account_id",
        "readiness_ledger_cas_version",
        "approved_by_account_id",
        "approval_expires_at",
        "approved_ledger_cas_version",
        "started_by_account_id",
        "started_ledger_cas_version",
        "completed_by_account_id",
        "completed_at",
        "completion_evidence",
        "completed_ledger_cas_version",
        "row_version",
    } <= set(KnowledgeFSCleanupAuthorization.__table__.columns.keys())


def test_cleanup_authorization_only_depends_on_cutover_ledger() -> None:
    table = KnowledgeFSCleanupAuthorization.__table__
    assert {foreign_key.column.table.name for foreign_key in table.foreign_keys} == {
        KnowledgeFSWorkspaceCutoverLedger.__tablename__
    }
    assert {foreign_key.ondelete for foreign_key in table.foreign_keys} == {None}
    assert not KnowledgeFSCleanupAuthorization.__mapper__.relationships
