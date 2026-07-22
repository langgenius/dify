from __future__ import annotations

from hashlib import sha256

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.knowledge_fs import (
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSCapabilityIssuanceAudit,
    KnowledgeFSCapabilityIssuanceReservation,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermission,
    KnowledgeFSControlSpacePermissionRole,
    KnowledgeFSControlSpacePermissionStatus,
    KnowledgeFSControlSpaceState,
    KnowledgeFSLifecycleOutbox,
)
from services.knowledge_fs.membership_changes import (
    KnowledgeFSWorkspaceMembershipChange,
    apply_workspace_membership_change,
    apply_workspace_rbac_role_change,
)
from services.knowledge_fs.revocation_commands import KnowledgeFSRevocationCommandError


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
def test_member_removal_reassigns_owned_spaces_and_revokes_grants_atomically(sqlite_session: Session) -> None:
    space = _space(owner_account_id="member-1")
    removed_owner = _permission(space, "member-1", KnowledgeFSControlSpacePermissionRole.OWNER)
    replacement = _permission(space, "owner-1", KnowledgeFSControlSpacePermissionRole.EDITOR)
    revision = KnowledgeFSAuthorizationRevision(tenant_id="tenant-1", control_space_id=space.id)
    sqlite_session.add_all(
        [
            space,
            removed_owner,
            replacement,
            revision,
            _audit(space, "member-1", "20000000-0000-4000-8000-000000000011"),
        ]
    )
    sqlite_session.commit()

    apply_workspace_membership_change(
        session=sqlite_session,
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        account_ids=("member-1",),
        change=KnowledgeFSWorkspaceMembershipChange.MEMBER_REMOVED,
        removed_account_id="member-1",
        replacement_owner_account_id="owner-1",
    )
    sqlite_session.commit()

    sqlite_session.expire_all()
    command = sqlite_session.scalar(select(KnowledgeFSLifecycleOutbox))
    assert space.owner_account_id == "owner-1"
    assert removed_owner.status is KnowledgeFSControlSpacePermissionStatus.REVOKED
    assert replacement.status is KnowledgeFSControlSpacePermissionStatus.ACTIVE
    assert replacement.role is KnowledgeFSControlSpacePermissionRole.OWNER
    assert revision.membership_epoch == 1
    assert revision.space_acl_epoch == 1
    assert command is not None
    assert command.command_payload["principal"] == "dify-account:member-1"
    assert command.command_payload["reason_code"] == "workspace_membership_removed"


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
def test_workspace_role_change_advances_each_space_epoch_and_revokes_affected_principals(
    sqlite_session: Session,
) -> None:
    spaces = [_space(suffix="1"), _space(suffix="2")]
    revisions = [KnowledgeFSAuthorizationRevision(tenant_id="tenant-1", control_space_id=space.id) for space in spaces]
    sqlite_session.add_all(
        [
            *spaces,
            *revisions,
            *[
                _audit(space, "member-1", f"20000000-0000-4000-8000-00000000002{index}")
                for index, space in enumerate(spaces, start=1)
            ],
        ]
    )
    sqlite_session.commit()

    apply_workspace_membership_change(
        session=sqlite_session,
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        account_ids=("member-1",),
        change=KnowledgeFSWorkspaceMembershipChange.ROLE_CHANGED,
    )
    sqlite_session.commit()

    sqlite_session.expire_all()
    commands = tuple(sqlite_session.scalars(select(KnowledgeFSLifecycleOutbox)))
    assert [revision.membership_epoch for revision in revisions] == [1, 1]
    assert len(commands) == 2
    assert {command.command_payload["reason_code"] for command in commands} == {"workspace_role_changed"}


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSCapabilityIssuanceReservation,
            KnowledgeFSLifecycleOutbox,
        )
    ],
    indirect=True,
)
def test_workspace_rbac_role_change_revokes_every_interactive_grant_without_touching_service_grants(
    sqlite_session: Session,
) -> None:
    space = _space()
    revision = KnowledgeFSAuthorizationRevision(tenant_id="tenant-1", control_space_id=space.id)
    sqlite_session.add_all(
        [
            space,
            revision,
            _audit(space, "member-1", "20000000-0000-4000-8000-000000000031"),
            _audit(space, "member-2", "20000000-0000-4000-8000-000000000032"),
            KnowledgeFSCapabilityIssuanceAudit(
                tenant_id="tenant-1",
                control_space_id=space.id,
                trace_id="trace-service-grant",
                jti_hash=f"sha256:{sha256(b'service-grant').hexdigest()}",
                claims_summary={
                    "caller_kind": "service_api",
                    "grant_id": "20000000-0000-4000-8000-000000000033",
                    "subject": "dify-api-credential:credential-1",
                },
            ),
        ]
    )
    sqlite_session.commit()

    apply_workspace_rbac_role_change(session=sqlite_session, tenant_id="tenant-1")
    sqlite_session.commit()

    sqlite_session.expire_all()
    commands = tuple(sqlite_session.scalars(select(KnowledgeFSLifecycleOutbox)))
    assert revision.membership_epoch == 1
    assert {command.command_payload["principal"] for command in commands} == {
        "dify-account:member-1",
        "dify-account:member-2",
    }
    assert {command.command_payload["reason_code"] for command in commands} == {"workspace_rbac_role_changed"}


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSCapabilityIssuanceReservation,
            KnowledgeFSLifecycleOutbox,
        )
    ],
    indirect=True,
)
def test_member_add_advances_epoch_without_revoking_existing_grants(sqlite_session: Session) -> None:
    space = _space()
    revision = KnowledgeFSAuthorizationRevision(tenant_id="tenant-1", control_space_id=space.id)
    sqlite_session.add_all([space, revision])
    sqlite_session.commit()

    apply_workspace_membership_change(
        session=sqlite_session,
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        account_ids=("member-1",),
        change=KnowledgeFSWorkspaceMembershipChange.MEMBER_ADDED,
    )
    sqlite_session.commit()

    assert revision.membership_epoch == 1
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
def test_member_removal_rolls_back_owner_and_epoch_when_revoke_reservation_is_invalid(
    sqlite_session: Session,
) -> None:
    space = _space(owner_account_id="member-1")
    removed_owner = _permission(space, "member-1", KnowledgeFSControlSpacePermissionRole.OWNER)
    revision = KnowledgeFSAuthorizationRevision(tenant_id="tenant-1", control_space_id=space.id)
    sqlite_session.add_all([space, removed_owner, revision, _audit(space, "member-1", "invalid-grant")])
    sqlite_session.commit()

    with pytest.raises(KnowledgeFSRevocationCommandError, match="not a UUID"):
        apply_workspace_membership_change(
            session=sqlite_session,
            tenant_id="tenant-1",
            actor_account_id="owner-1",
            account_ids=("member-1",),
            change=KnowledgeFSWorkspaceMembershipChange.MEMBER_REMOVED,
            removed_account_id="member-1",
            replacement_owner_account_id="owner-1",
        )
    sqlite_session.rollback()
    sqlite_session.expire_all()

    assert space.owner_account_id == "member-1"
    assert removed_owner.status is KnowledgeFSControlSpacePermissionStatus.ACTIVE
    assert revision.membership_epoch == 0
    assert sqlite_session.scalar(select(KnowledgeFSLifecycleOutbox)) is None


def _space(*, owner_account_id: str = "owner-1", suffix: str = "0") -> KnowledgeFSControlSpace:
    return KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id=owner_account_id,
        provisioning_key=f"membership-change-{suffix}",
        knowledge_space_id=f"10000000-0000-4000-8000-00000000000{suffix}",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )


def _permission(
    space: KnowledgeFSControlSpace,
    account_id: str,
    role: KnowledgeFSControlSpacePermissionRole,
) -> KnowledgeFSControlSpacePermission:
    return KnowledgeFSControlSpacePermission(
        tenant_id="tenant-1",
        control_space_id=space.id,
        account_id=account_id,
        role=role,
    )


def _audit(space: KnowledgeFSControlSpace, account_id: str, grant_id: str) -> KnowledgeFSCapabilityIssuanceAudit:
    return KnowledgeFSCapabilityIssuanceAudit(
        tenant_id="tenant-1",
        control_space_id=space.id,
        trace_id=f"trace-{grant_id}",
        jti_hash=f"sha256:{sha256(grant_id.encode()).hexdigest()}",
        claims_summary={
            "caller_kind": "interactive",
            "grant_id": grant_id,
            "subject": f"dify-account:{account_id}",
        },
    )
