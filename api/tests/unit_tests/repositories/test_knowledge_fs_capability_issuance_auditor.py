from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import (
    KnowledgeFSCapabilityIssuanceAudit,
    KnowledgeFSCapabilityIssuanceReservation,
    KnowledgeFSCapabilityIssuanceReservationStatus,
    KnowledgeFSControlSpace,
)
from repositories.sqlalchemy_knowledge_fs_capability_issuance_auditor import (
    SQLAlchemyKnowledgeFSCapabilityIssuanceAuditor,
)
from repositories.sqlalchemy_knowledge_fs_capability_issuance_reservation_repository import (
    SQLAlchemyKnowledgeFSCapabilityIssuanceReservationRepository,
)
from services.knowledge_fs_capability import (
    CapabilityAuthzRevision,
    CapabilityIssuanceAuditEvent,
    CapabilityIssueRequest,
    CapabilityResource,
)


def test_auditor_commits_sanitized_event_before_returning() -> None:
    engine = create_engine("sqlite:///:memory:")
    KnowledgeFSControlSpace.metadata.create_all(
        engine,
        tables=[KnowledgeFSControlSpace.__table__, KnowledgeFSCapabilityIssuanceAudit.__table__],
    )
    session_maker = sessionmaker(bind=engine, expire_on_commit=False)
    with session_maker.begin() as session:
        control_space = KnowledgeFSControlSpace(
            tenant_id="tenant-1",
            owner_account_id="account-1",
            provisioning_key="provision-1",
        )
        session.add(control_space)

    auditor = SQLAlchemyKnowledgeFSCapabilityIssuanceAuditor(session_maker)
    issued_at = datetime(2026, 7, 21, tzinfo=UTC)
    auditor.record(
        CapabilityIssuanceAuditEvent(
            action="knowledge_spaces.provision",
            actor="dify-worker:knowledge-fs-lifecycle",
            authz_revision=CapabilityAuthzRevision(
                membership_epoch=1,
                space_acl_epoch=2,
                external_access_epoch=3,
                credential_revision=None,
            ),
            caller_kind="internal_worker",
            content_policy_revision=4,
            content_scope_ids=(),
            control_space_id=control_space.id,
            expires_at=issued_at + timedelta(minutes=1),
            grant_id="grant-1",
            issued_at=issued_at,
            jti_hash="sha256:abcdef",
            namespace_id="tenant-1",
            operation_id="provisionIntegratedKnowledgeSpace",
            resource_id="tenant-1",
            resource_parent_id=None,
            resource_type="namespace",
            subject="dify-worker:knowledge-fs-lifecycle",
            trace_id="trace-1",
        )
    )

    with Session(engine) as session:
        audit = session.scalar(select(KnowledgeFSCapabilityIssuanceAudit))
    assert audit is not None
    assert audit.tenant_id == "tenant-1"
    assert audit.control_space_id == control_space.id
    assert audit.jti_hash == "sha256:abcdef"
    assert audit.claims_summary == {
        "action": "knowledge_spaces.provision",
        "actor": "dify-worker:knowledge-fs-lifecycle",
        "authz_revision": {
            "credential_revision": None,
            "external_access_epoch": 3,
            "membership_epoch": 1,
            "space_acl_epoch": 2,
        },
        "caller_kind": "internal_worker",
        "content_policy_revision": 4,
        "content_scope_ids": [],
        "control_space_id": control_space.id,
        "expires_at": "2026-07-21T00:01:00Z",
        "grant_id": "grant-1",
        "issued_at": "2026-07-21T00:00:00Z",
        "namespace_id": "tenant-1",
        "operation_id": "provisionIntegratedKnowledgeSpace",
        "resource_id": "tenant-1",
        "resource_parent_id": None,
        "resource_type": "namespace",
        "subject": "dify-worker:knowledge-fs-lifecycle",
    }
    assert "raw-jti" not in str(audit.claims_summary)


def test_terminal_reservation_cleanup_never_removes_an_active_fence() -> None:
    engine = create_engine("sqlite:///:memory:")
    KnowledgeFSControlSpace.metadata.create_all(
        engine,
        tables=[KnowledgeFSControlSpace.__table__, KnowledgeFSCapabilityIssuanceReservation.__table__],
    )
    session_maker = sessionmaker(bind=engine, expire_on_commit=False)
    with session_maker.begin() as session:
        control_space = KnowledgeFSControlSpace(
            tenant_id="tenant-1",
            owner_account_id="account-1",
            provisioning_key="provision-reservation",
        )
        session.add(control_space)
    request = CapabilityIssueRequest(
        actor="dify-account:account-1",
        authz_revision=CapabilityAuthzRevision(
            membership_epoch=1,
            space_acl_epoch=2,
            external_access_epoch=3,
            credential_revision=None,
        ),
        caller_kind="interactive",
        content_policy_revision=4,
        control_space_id=control_space.id,
        grant_id="20000000-0000-4000-8000-000000000001",
        namespace_id="tenant-1",
        operation_id="createQuery",
        principal_id="account-1",
        resource=CapabilityResource(type="knowledge_space", id="space-1"),
        trace_id="trace-reservation",
    )
    active_request = request.model_copy(
        update={
            "grant_id": "20000000-0000-4000-8000-000000000002",
            "trace_id": "trace-active",
        }
    )
    failed_at = datetime(2026, 7, 21, 12, 0)
    with session_maker.begin() as session:
        repository = SQLAlchemyKnowledgeFSCapabilityIssuanceReservationRepository(session)
        repository.reserve(request)
        repository.reserve(active_request)
        repository.mark_failed(
            tenant_id="tenant-1",
            grant_id=request.grant_id,
            failed_at=failed_at,
            failure_code="AuditUnavailable",
        )

    with session_maker.begin() as session:
        repository = SQLAlchemyKnowledgeFSCapabilityIssuanceReservationRepository(session)
        failed = session.scalar(
            select(KnowledgeFSCapabilityIssuanceReservation).where(
                KnowledgeFSCapabilityIssuanceReservation.grant_id == request.grant_id
            )
        )
        assert failed is not None
        assert failed.status is KnowledgeFSCapabilityIssuanceReservationStatus.FAILED
        assert failed.cleanup_after is not None
        assert repository.cleanup_terminal(before=failed.cleanup_after) == 1

    with session_maker() as session:
        remaining = session.scalar(select(KnowledgeFSCapabilityIssuanceReservation))
    assert remaining is not None
    assert remaining.grant_id == active_request.grant_id
    assert remaining.status is KnowledgeFSCapabilityIssuanceReservationStatus.RESERVED
