from __future__ import annotations

from collections.abc import Sequence

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import (
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSCapabilityIssuanceAudit,
    KnowledgeFSCapabilityIssuanceReservation,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermission,
    KnowledgeFSControlSpacePermissionRole,
    KnowledgeFSControlSpacePermissionStatus,
    KnowledgeFSControlSpaceState,
    KnowledgeFSControlSpaceVisibility,
    KnowledgeFSExternalAccessPolicy,
    KnowledgeFSLifecycleOutbox,
)
from services.knowledge_fs.control_plane_service import KnowledgeFSControlPlaneService
from services.knowledge_fs.product_dto import (
    KnowledgeFSExternalAccessPayload,
    KnowledgeFSMemberBindingPayload,
)
from services.knowledge_fs.product_operations import KnowledgeFSProductPermission
from services.knowledge_fs.product_service import AuthorizedKnowledgeFSControlSpace
from services.knowledge_fs.revocation_commands import KnowledgeFSRevocationCommandError


class FakeProduct:
    def __init__(self, control_space: KnowledgeFSControlSpace):
        self.control_space = control_space
        self.calls: list[KnowledgeFSProductPermission] = []

    def authorize_control_space(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        permission: KnowledgeFSProductPermission,
        require_active: bool = False,
    ) -> AuthorizedKnowledgeFSControlSpace:
        _ = (tenant_id, account_id, control_space_id, require_active)
        self.calls.append(permission)
        return AuthorizedKnowledgeFSControlSpace(self.control_space, permission, (permission,))


class FakeMembers:
    def __init__(self, account_ids: Sequence[str]):
        self.account_ids = frozenset(account_ids)

    def are_active_members(self, *, session: Session, tenant_id: str, account_ids: Sequence[str]) -> bool:
        _ = (session, tenant_id)
        return frozenset(account_ids).issubset(self.account_ids)


def _issuance_audit(
    *,
    control_space_id: str,
    grant_id: str,
    subject: str,
    caller_kind: str,
    marker: str,
) -> KnowledgeFSCapabilityIssuanceAudit:
    return KnowledgeFSCapabilityIssuanceAudit(
        tenant_id="tenant-1",
        control_space_id=control_space_id,
        trace_id=f"trace-{marker}",
        jti_hash=f"sha256:{marker * 64}",
        claims_summary={
            "caller_kind": caller_kind,
            "grant_id": grant_id,
            "subject": subject,
        },
    )


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSControlSpacePermission,
            KnowledgeFSExternalAccessPolicy,
            KnowledgeFSAuthorizationRevision,
        )
    ],
    indirect=True,
)
def test_member_visibility_and_external_policy_updates_bump_authorization_epochs(sqlite_session: Session) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="owner-1",
        provisioning_key="provision-1",
    )
    sqlite_session.add_all(
        [
            space,
            KnowledgeFSControlSpacePermission(
                tenant_id="tenant-1",
                control_space_id=space.id,
                account_id="owner-1",
                role=KnowledgeFSControlSpacePermissionRole.OWNER,
            ),
            KnowledgeFSAuthorizationRevision(tenant_id="tenant-1", control_space_id=space.id),
        ]
    )
    sqlite_session.commit()
    service = KnowledgeFSControlPlaneService(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        product=FakeProduct(space),  # type: ignore[arg-type]
        members=FakeMembers(["member-1"]),
    )

    response = service.replace_members(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        members=[
            KnowledgeFSMemberBindingPayload(
                account_id="member-1",
                role=KnowledgeFSControlSpacePermissionRole.EDITOR,
            )
        ],
    )
    service.update_visibility(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        visibility=KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS,
    )
    external = service.update_external_access(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        payload=KnowledgeFSExternalAccessPayload(
            service_api_enabled=True,
            agent_enabled=False,
            workflow_enabled=True,
        ),
    )

    revision = sqlite_session.scalar(
        select(KnowledgeFSAuthorizationRevision).where(KnowledgeFSAuthorizationRevision.control_space_id == space.id)
    )
    member = sqlite_session.scalar(
        select(KnowledgeFSControlSpacePermission).where(
            KnowledgeFSControlSpacePermission.control_space_id == space.id,
            KnowledgeFSControlSpacePermission.account_id == "member-1",
        )
    )
    assert {item.account_id for item in response.data} == {"owner-1", "member-1"}
    assert member is not None
    assert member.status is KnowledgeFSControlSpacePermissionStatus.ACTIVE
    assert revision is not None
    assert revision.space_acl_epoch == 2
    assert revision.external_access_epoch == 1
    assert external.service_api_enabled is True
    assert external.revision == 1


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSControlSpacePermission,
            KnowledgeFSExternalAccessPolicy,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSCapabilityIssuanceReservation,
            KnowledgeFSLifecycleOutbox,
        )
    ],
    indirect=True,
)
def test_visibility_and_external_access_narrowing_revoke_only_newly_affected_grants(
    sqlite_session: Session,
) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="owner-1",
        provisioning_key="provision-policy-revoke",
        knowledge_space_id="10000000-0000-4000-8000-000000000010",
        state=KnowledgeFSControlSpaceState.ACTIVE,
        visibility=KnowledgeFSControlSpaceVisibility.ALL_TEAM_MEMBERS,
    )
    sqlite_session.add_all(
        [
            space,
            KnowledgeFSControlSpacePermission(
                tenant_id="tenant-1",
                control_space_id=space.id,
                account_id="owner-1",
                role=KnowledgeFSControlSpacePermissionRole.OWNER,
            ),
            KnowledgeFSControlSpacePermission(
                tenant_id="tenant-1",
                control_space_id=space.id,
                account_id="member-1",
                role=KnowledgeFSControlSpacePermissionRole.EDITOR,
            ),
            KnowledgeFSExternalAccessPolicy(
                tenant_id="tenant-1",
                control_space_id=space.id,
                service_api_enabled=True,
                agent_enabled=True,
                revision=7,
            ),
            KnowledgeFSAuthorizationRevision(tenant_id="tenant-1", control_space_id=space.id),
            _issuance_audit(
                control_space_id=space.id,
                grant_id="20000000-0000-4000-8000-000000000010",
                subject="dify-account:owner-1",
                caller_kind="interactive",
                marker="a",
            ),
            _issuance_audit(
                control_space_id=space.id,
                grant_id="20000000-0000-4000-8000-000000000011",
                subject="dify-account:member-1",
                caller_kind="interactive",
                marker="b",
            ),
            _issuance_audit(
                control_space_id=space.id,
                grant_id="20000000-0000-4000-8000-000000000012",
                subject="dify-account:workspace-member-without-binding",
                caller_kind="interactive",
                marker="c",
            ),
            _issuance_audit(
                control_space_id=space.id,
                grant_id="20000000-0000-4000-8000-000000000013",
                subject="dify-service-credential:credential-1",
                caller_kind="service",
                marker="d",
            ),
            _issuance_audit(
                control_space_id=space.id,
                grant_id="20000000-0000-4000-8000-000000000014",
                subject="dify-app:app-1",
                caller_kind="agent",
                marker="e",
            ),
        ]
    )
    sqlite_session.commit()
    service = KnowledgeFSControlPlaneService(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        product=FakeProduct(space),  # type: ignore[arg-type]
        members=FakeMembers(["member-1"]),
    )

    service.update_visibility(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        visibility=KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS,
    )
    service.update_visibility(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        visibility=KnowledgeFSControlSpaceVisibility.ONLY_ME,
    )
    service.update_visibility(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        visibility=KnowledgeFSControlSpaceVisibility.ONLY_ME,
    )
    disabled = KnowledgeFSExternalAccessPayload(
        service_api_enabled=False,
        agent_enabled=False,
        workflow_enabled=False,
    )
    first_external = service.update_external_access(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        payload=disabled,
    )
    replayed_external = service.update_external_access(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        payload=disabled,
    )

    sqlite_session.expire_all()
    revision = sqlite_session.scalar(
        select(KnowledgeFSAuthorizationRevision).where(KnowledgeFSAuthorizationRevision.control_space_id == space.id)
    )
    commands = tuple(sqlite_session.scalars(select(KnowledgeFSLifecycleOutbox)))
    payloads = sorted(commands, key=lambda command: command.command_payload["revoke_sequence"])
    assert [command.command_payload["grant_id"] for command in payloads] == [
        "20000000-0000-4000-8000-000000000012",
        "20000000-0000-4000-8000-000000000011",
        "20000000-0000-4000-8000-000000000014",
        "20000000-0000-4000-8000-000000000013",
    ]
    assert [command.command_payload["revoke_sequence"] for command in payloads] == [1, 2, 3, 4]
    assert [command.command_payload["reason_code"] for command in payloads] == [
        "visibility_narrowed",
        "visibility_narrowed",
        "external_access_revoked",
        "external_access_revoked",
    ]
    assert all(command.command_payload["principal"] != "dify-account:owner-1" for command in payloads)
    assert revision is not None
    assert revision.space_acl_epoch == 2
    assert revision.external_access_epoch == 1
    assert revision.revoke_sequence == 4
    assert first_external.revision == replayed_external.revision == 8


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
        )
    ],
    indirect=True,
)
def test_external_access_narrowing_rolls_back_when_revoke_enqueue_fails(sqlite_session: Session) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="owner-1",
        provisioning_key="provision-policy-rollback",
        knowledge_space_id="10000000-0000-4000-8000-000000000020",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    policy = KnowledgeFSExternalAccessPolicy(
        tenant_id="tenant-1",
        control_space_id=space.id,
        service_api_enabled=True,
        revision=3,
    )
    sqlite_session.add_all(
        [
            space,
            policy,
            KnowledgeFSAuthorizationRevision(tenant_id="tenant-1", control_space_id=space.id),
            _issuance_audit(
                control_space_id=space.id,
                grant_id="legacy-non-uuid-grant",
                subject="dify-service-credential:credential-1",
                caller_kind="service",
                marker="f",
            ),
        ]
    )
    sqlite_session.commit()
    service = KnowledgeFSControlPlaneService(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        product=FakeProduct(space),  # type: ignore[arg-type]
        members=FakeMembers([]),
    )

    with pytest.raises(KnowledgeFSRevocationCommandError, match="not a UUID"):
        service.update_external_access(
            tenant_id="tenant-1",
            actor_account_id="owner-1",
            control_space_id=space.id,
            payload=KnowledgeFSExternalAccessPayload(
                service_api_enabled=False,
                agent_enabled=False,
                workflow_enabled=False,
            ),
        )

    sqlite_session.expire_all()
    persisted_policy = sqlite_session.get(KnowledgeFSExternalAccessPolicy, policy.id)
    revision = sqlite_session.scalar(select(KnowledgeFSAuthorizationRevision))
    assert persisted_policy is not None
    assert persisted_policy.service_api_enabled is True
    assert persisted_policy.revision == 3
    assert revision is not None
    assert revision.external_access_epoch == 0
    assert revision.revoke_sequence == 0
    assert sqlite_session.scalar(select(KnowledgeFSLifecycleOutbox)) is None


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSControlSpacePermission,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSCapabilityIssuanceReservation,
            KnowledgeFSLifecycleOutbox,
        )
    ],
    indirect=True,
)
def test_member_revoke_atomically_enqueues_exact_grants_once(sqlite_session: Session) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="owner-1",
        provisioning_key="provision-revoke",
        knowledge_space_id="10000000-0000-4000-8000-000000000001",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    member = KnowledgeFSControlSpacePermission(
        tenant_id="tenant-1",
        control_space_id=space.id,
        account_id="member-1",
        role=KnowledgeFSControlSpacePermissionRole.EDITOR,
    )
    sqlite_session.add_all(
        [
            space,
            member,
            KnowledgeFSAuthorizationRevision(tenant_id="tenant-1", control_space_id=space.id),
            KnowledgeFSCapabilityIssuanceAudit(
                tenant_id="tenant-1",
                control_space_id=space.id,
                trace_id="trace-member",
                jti_hash=f"sha256:{'a' * 64}",
                claims_summary={
                    "caller_kind": "interactive",
                    "grant_id": "20000000-0000-4000-8000-000000000001",
                    "subject": "dify-account:member-1",
                },
            ),
        ]
    )
    sqlite_session.commit()
    service = KnowledgeFSControlPlaneService(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        product=FakeProduct(space),  # type: ignore[arg-type]
        members=FakeMembers([]),
    )

    service.replace_members(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        members=[],
    )
    service.replace_members(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        members=[],
    )

    sqlite_session.expire_all()
    command = sqlite_session.scalar(select(KnowledgeFSLifecycleOutbox))
    revision = sqlite_session.scalar(
        select(KnowledgeFSAuthorizationRevision).where(KnowledgeFSAuthorizationRevision.control_space_id == space.id)
    )
    assert command is not None
    assert command.command_payload["principal"] == "dify-account:member-1"
    assert command.command_payload["revoke_sequence"] == 1
    assert member.status is KnowledgeFSControlSpacePermissionStatus.REVOKED
    assert revision is not None
    assert revision.revoke_sequence == 1


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSControlSpacePermission,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSCapabilityIssuanceReservation,
            KnowledgeFSLifecycleOutbox,
        )
    ],
    indirect=True,
)
def test_member_role_downgrade_atomically_revokes_existing_write_grants_once(sqlite_session: Session) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="owner-1",
        provisioning_key="provision-role-downgrade",
        knowledge_space_id="10000000-0000-4000-8000-000000000003",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    member = KnowledgeFSControlSpacePermission(
        tenant_id="tenant-1",
        control_space_id=space.id,
        account_id="member-1",
        role=KnowledgeFSControlSpacePermissionRole.EDITOR,
    )
    sqlite_session.add_all(
        [
            space,
            member,
            KnowledgeFSAuthorizationRevision(tenant_id="tenant-1", control_space_id=space.id),
            KnowledgeFSCapabilityIssuanceAudit(
                tenant_id="tenant-1",
                control_space_id=space.id,
                trace_id="trace-role-downgrade",
                jti_hash=f"sha256:{'e' * 64}",
                claims_summary={
                    "caller_kind": "interactive",
                    "grant_id": "20000000-0000-4000-8000-000000000003",
                    "subject": "dify-account:member-1",
                },
            ),
        ]
    )
    sqlite_session.commit()
    service = KnowledgeFSControlPlaneService(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        product=FakeProduct(space),  # type: ignore[arg-type]
        members=FakeMembers(["member-1"]),
    )
    viewer_binding = KnowledgeFSMemberBindingPayload(
        account_id="member-1",
        role=KnowledgeFSControlSpacePermissionRole.VIEWER,
    )

    service.replace_members(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        members=[viewer_binding],
    )
    service.replace_members(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        members=[viewer_binding],
    )

    sqlite_session.expire_all()
    persisted_member = sqlite_session.get(KnowledgeFSControlSpacePermission, member.id)
    command = sqlite_session.scalar(select(KnowledgeFSLifecycleOutbox))
    revision = sqlite_session.scalar(select(KnowledgeFSAuthorizationRevision))
    assert persisted_member is not None
    assert persisted_member.role is KnowledgeFSControlSpacePermissionRole.VIEWER
    assert persisted_member.status is KnowledgeFSControlSpacePermissionStatus.ACTIVE
    assert command is not None
    assert command.command_payload["principal"] == "dify-account:member-1"
    assert command.command_payload["reason_code"] == "permission_role_narrowed"
    assert revision is not None
    assert revision.revoke_sequence == 1


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSControlSpacePermission,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSCapabilityIssuanceReservation,
            KnowledgeFSLifecycleOutbox,
        )
    ],
    indirect=True,
)
def test_member_role_downgrade_rolls_back_when_revoke_enqueue_fails(sqlite_session: Session) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="owner-1",
        provisioning_key="provision-role-downgrade-rollback",
        knowledge_space_id="10000000-0000-4000-8000-000000000004",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    member = KnowledgeFSControlSpacePermission(
        tenant_id="tenant-1",
        control_space_id=space.id,
        account_id="member-1",
        role=KnowledgeFSControlSpacePermissionRole.EDITOR,
    )
    sqlite_session.add_all(
        [
            space,
            member,
            KnowledgeFSAuthorizationRevision(tenant_id="tenant-1", control_space_id=space.id),
            KnowledgeFSCapabilityIssuanceAudit(
                tenant_id="tenant-1",
                control_space_id=space.id,
                trace_id="trace-role-downgrade-invalid",
                jti_hash=f"sha256:{'f' * 64}",
                claims_summary={
                    "caller_kind": "interactive",
                    "grant_id": "invalid-grant-id",
                    "subject": "dify-account:member-1",
                },
            ),
        ]
    )
    sqlite_session.commit()
    service = KnowledgeFSControlPlaneService(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        product=FakeProduct(space),  # type: ignore[arg-type]
        members=FakeMembers(["member-1"]),
    )

    with pytest.raises(KnowledgeFSRevocationCommandError, match="not a UUID"):
        service.replace_members(
            tenant_id="tenant-1",
            actor_account_id="owner-1",
            control_space_id=space.id,
            members=[
                KnowledgeFSMemberBindingPayload(
                    account_id="member-1",
                    role=KnowledgeFSControlSpacePermissionRole.VIEWER,
                )
            ],
        )

    sqlite_session.expire_all()
    persisted_member = sqlite_session.get(KnowledgeFSControlSpacePermission, member.id)
    revision = sqlite_session.scalar(select(KnowledgeFSAuthorizationRevision))
    assert persisted_member is not None
    assert persisted_member.role is KnowledgeFSControlSpacePermissionRole.EDITOR
    assert persisted_member.status is KnowledgeFSControlSpacePermissionStatus.ACTIVE
    assert revision is not None
    assert revision.revoke_sequence == 0
    assert sqlite_session.scalar(select(KnowledgeFSLifecycleOutbox)) is None


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSControlSpacePermission,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSCapabilityIssuanceReservation,
            KnowledgeFSLifecycleOutbox,
        )
    ],
    indirect=True,
)
def test_member_revoke_rolls_back_source_state_when_outbox_production_fails(sqlite_session: Session) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="owner-1",
        provisioning_key="provision-rollback",
        knowledge_space_id="10000000-0000-4000-8000-000000000002",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    member = KnowledgeFSControlSpacePermission(
        tenant_id="tenant-1",
        control_space_id=space.id,
        account_id="member-1",
        role=KnowledgeFSControlSpacePermissionRole.EDITOR,
    )
    sqlite_session.add_all(
        [
            space,
            member,
            KnowledgeFSAuthorizationRevision(tenant_id="tenant-1", control_space_id=space.id),
            KnowledgeFSCapabilityIssuanceAudit(
                tenant_id="tenant-1",
                control_space_id=space.id,
                trace_id="trace-invalid-grant",
                jti_hash=f"sha256:{'d' * 64}",
                claims_summary={
                    "caller_kind": "interactive",
                    "grant_id": "legacy-non-uuid-grant",
                    "subject": "dify-account:member-1",
                },
            ),
        ]
    )
    sqlite_session.commit()
    service = KnowledgeFSControlPlaneService(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        product=FakeProduct(space),  # type: ignore[arg-type]
        members=FakeMembers([]),
    )

    with pytest.raises(KnowledgeFSRevocationCommandError, match="not a UUID"):
        service.replace_members(
            tenant_id="tenant-1",
            actor_account_id="owner-1",
            control_space_id=space.id,
            members=[],
        )

    sqlite_session.expire_all()
    persisted_member = sqlite_session.get(KnowledgeFSControlSpacePermission, member.id)
    revision = sqlite_session.scalar(select(KnowledgeFSAuthorizationRevision))
    assert persisted_member is not None
    assert persisted_member.status is KnowledgeFSControlSpacePermissionStatus.ACTIVE
    assert revision is not None
    assert revision.revoke_sequence == 0
    assert sqlite_session.scalar(select(KnowledgeFSLifecycleOutbox)) is None
