from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import (
    AppKnowledgeFSSpaceJoin,
    KnowledgeFSAppSpaceJoinStatus,
    KnowledgeFSAppSpaceJoinType,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSCapabilityIssuanceAudit,
    KnowledgeFSCapabilityIssuanceReservation,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpaceState,
    KnowledgeFSExternalAccessPolicy,
    KnowledgeFSLifecycleOutbox,
)
from services.knowledge_fs.app_admission_service import (
    KnowledgeFSAppAdmissionError,
    KnowledgeFSAppAdmissionService,
)


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSExternalAccessPolicy,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSCapabilityIssuanceReservation,
            KnowledgeFSLifecycleOutbox,
            AppKnowledgeFSSpaceJoin,
        )
    ],
    indirect=True,
)
def test_agent_admission_requires_explicit_join_and_enabled_channel(sqlite_session: Session) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="owner-1",
        provisioning_key="provision-1",
        knowledge_space_id="space-1",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    policy = KnowledgeFSExternalAccessPolicy(
        tenant_id="tenant-1",
        control_space_id=space.id,
        agent_enabled=False,
    )
    sqlite_session.add_all(
        [
            space,
            policy,
            KnowledgeFSAuthorizationRevision(
                tenant_id="tenant-1",
                control_space_id=space.id,
                external_access_epoch=4,
            ),
            AppKnowledgeFSSpaceJoin(
                tenant_id="tenant-1",
                control_space_id=space.id,
                app_id="app-1",
                join_type=KnowledgeFSAppSpaceJoinType.AGENT,
            ),
        ]
    )
    sqlite_session.commit()
    service = KnowledgeFSAppAdmissionService(sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False))

    with pytest.raises(KnowledgeFSAppAdmissionError):
        service.admit(
            tenant_id="tenant-1",
            app_id="app-1",
            control_space_id=space.id,
            caller_kind=KnowledgeFSAppSpaceJoinType.AGENT,
            operation_id="createResearchTask",
        )

    policy.agent_enabled = True
    sqlite_session.commit()
    profile = service.admit(
        tenant_id="tenant-1",
        app_id="app-1",
        control_space_id=space.id,
        caller_kind=KnowledgeFSAppSpaceJoinType.AGENT,
        operation_id="createResearchTask",
    )

    assert profile.action == "research_tasks.create"
    assert profile.knowledge_space_id == "space-1"
    assert profile.external_access_epoch == 4

    sqlite_session.add(
        KnowledgeFSCapabilityIssuanceAudit(
            tenant_id="tenant-1",
            control_space_id=space.id,
            trace_id="trace-app",
            jti_hash=f"sha256:{'c' * 64}",
            claims_summary={
                "caller_kind": "agent",
                "grant_id": "20000000-0000-4000-8000-000000000003",
                "subject": "dify-app:app-1",
            },
        )
    )
    sqlite_session.commit()
    service.revoke_binding(
        tenant_id="tenant-1",
        app_id="app-1",
        control_space_id=space.id,
        caller_kind=KnowledgeFSAppSpaceJoinType.AGENT,
        revoked_by_account_id="owner-1",
    )

    join = sqlite_session.scalar(select(AppKnowledgeFSSpaceJoin))
    command = sqlite_session.scalar(select(KnowledgeFSLifecycleOutbox))
    revision = sqlite_session.scalar(select(KnowledgeFSAuthorizationRevision))
    assert join is not None
    assert join.status is KnowledgeFSAppSpaceJoinStatus.REVOKED
    assert command is not None
    assert command.command_payload["principal"] == "dify-app:app-1"
    assert revision is not None
    assert revision.external_access_epoch == 5
    assert revision.revoke_sequence == 1
