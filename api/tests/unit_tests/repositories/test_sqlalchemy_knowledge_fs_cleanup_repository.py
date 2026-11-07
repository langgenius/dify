from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy.orm import Session

from models.knowledge_fs_cleanup import (
    KnowledgeFSCleanupAuthorization,
    KnowledgeFSCleanupAuthorizationStatus,
)
from models.knowledge_fs_cutover import KnowledgeFSWorkspaceCutoverLedger
from repositories.knowledge_fs_cleanup_repository import KnowledgeFSCleanupAuthorizationCASUpdate
from repositories.sqlalchemy_knowledge_fs_cleanup_repository import (
    SQLAlchemyKnowledgeFSCleanupAuthorizationRepository,
)

_WATERMARK = {
    "membership_epoch": 1,
    "space_acl_epoch": 1,
    "external_access_epoch": 1,
    "content_policy_revision": 1,
}


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSWorkspaceCutoverLedger, KnowledgeFSCleanupAuthorization)],
    indirect=True,
)
def test_cleanup_authorization_status_and_row_version_are_cas_scoped(sqlite_session: Session) -> None:
    ledger = KnowledgeFSWorkspaceCutoverLedger(
        tenant_id="tenant-1",
        source_revision_watermark=_WATERMARK,
        applied_revision_watermark=_WATERMARK,
    )
    sqlite_session.add(ledger)
    sqlite_session.flush()
    repository = SQLAlchemyKnowledgeFSCleanupAuthorizationRepository(sqlite_session)
    repository.add(
        KnowledgeFSCleanupAuthorization(
            tenant_id="tenant-1",
            ledger_id=ledger.id,
            request_id="request-1",
            plan_schema_version="knowledge-fs-p9-cleanup/v1",
            plan_digest=f"sha256:{'a' * 64}",
            targets=["legacy_acl_schema"],
            readiness_evidence={"environment": "production"},
            requested_by_account_id="requester-1",
            requested_at=datetime(2026, 7, 21, 12, 0),
            readiness_ledger_cas_version=1,
        )
    )
    update = KnowledgeFSCleanupAuthorizationCASUpdate(
        tenant_id="tenant-1",
        ledger_id=ledger.id,
        request_id="request-1",
        expected_status=KnowledgeFSCleanupAuthorizationStatus.REQUESTED,
        expected_row_version=0,
        new_status=KnowledgeFSCleanupAuthorizationStatus.APPROVED,
        approved_by_account_id="approver-1",
        approved_at=datetime(2026, 7, 21, 13, 0),
        approval_expires_at=datetime(2026, 7, 21, 14, 0),
        approved_ledger_cas_version=2,
    )

    assert repository.compare_and_set(update) is True
    assert repository.compare_and_set(update) is False
    sqlite_session.commit()

    authorization = repository.get(tenant_id="tenant-1", ledger_id=ledger.id, request_id="request-1")
    assert authorization is not None
    assert authorization.status is KnowledgeFSCleanupAuthorizationStatus.APPROVED
    assert authorization.row_version == 1
    assert authorization.approved_by_account_id == "approver-1"
