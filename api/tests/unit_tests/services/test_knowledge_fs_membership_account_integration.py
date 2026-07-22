from __future__ import annotations

from hashlib import sha256
from unittest.mock import patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Account, App, Dataset, Tenant, TenantAccountJoin
from models.account import TenantAccountRole
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
from services.account_service import TenantService

_TABLES = (
    Account,
    Tenant,
    TenantAccountJoin,
    App,
    Dataset,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermission,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSCapabilityIssuanceAudit,
    KnowledgeFSCapabilityIssuanceReservation,
    KnowledgeFSLifecycleOutbox,
)


@pytest.mark.parametrize("sqlite_session", [_TABLES], indirect=True)
def test_create_tenant_member_advances_existing_knowledge_fs_membership_epoch(sqlite_session: Session) -> None:
    tenant, owner, member = _workspace_accounts(sqlite_session, include_member=False)
    space = _space(tenant, owner.id)
    revision = KnowledgeFSAuthorizationRevision(tenant_id=tenant.id, control_space_id=space.id)
    sqlite_session.add_all([space, revision])
    sqlite_session.commit()

    TenantService.create_tenant_member(tenant, member, sqlite_session, role="normal")

    assert revision.membership_epoch == 1
    assert sqlite_session.scalar(select(KnowledgeFSLifecycleOutbox)) is None


@pytest.mark.parametrize("sqlite_session", [_TABLES], indirect=True)
def test_update_workspace_role_revokes_late_durable_grants_in_same_commit(sqlite_session: Session) -> None:
    tenant, owner, member = _workspace_accounts(sqlite_session, member_role=TenantAccountRole.ADMIN)
    space = _space(tenant, owner.id, suffix="2")
    revision = KnowledgeFSAuthorizationRevision(tenant_id=tenant.id, control_space_id=space.id)
    sqlite_session.add_all([space, revision, _audit(tenant, space, member.id, "2")])
    sqlite_session.commit()

    with patch("services.account_service.dify_config.RBAC_ENABLED", False):
        TenantService.update_member_role(tenant, member, "normal", owner, session=sqlite_session)

    command = sqlite_session.scalar(select(KnowledgeFSLifecycleOutbox))
    assert revision.membership_epoch == 1
    assert command is not None
    assert command.command_payload["principal"] == f"dify-account:{member.id}"
    assert command.command_payload["reason_code"] == "workspace_role_changed"


@pytest.mark.parametrize("sqlite_session", [_TABLES], indirect=True)
def test_remove_member_reassigns_owned_control_space_before_deleting_membership(sqlite_session: Session) -> None:
    tenant, owner, member = _workspace_accounts(sqlite_session)
    space = _space(tenant, member.id, suffix="3")
    member_permission = KnowledgeFSControlSpacePermission(
        tenant_id=tenant.id,
        control_space_id=space.id,
        account_id=member.id,
        role=KnowledgeFSControlSpacePermissionRole.OWNER,
    )
    revision = KnowledgeFSAuthorizationRevision(tenant_id=tenant.id, control_space_id=space.id)
    sqlite_session.add_all([space, member_permission, revision, _audit(tenant, space, member.id, "3")])
    sqlite_session.commit()

    with (
        patch("services.account_service.dify_config.BILLING_ENABLED", False),
        patch("services.account_service.dify_config.RBAC_ENABLED", False),
        patch(
            "services.enterprise.account_deletion_sync.sync_workspace_member_removal",
            return_value=True,
        ),
    ):
        TenantService.remove_member_from_tenant(tenant, member, owner, session=sqlite_session)

    command = sqlite_session.scalar(select(KnowledgeFSLifecycleOutbox))
    assert space.owner_account_id == owner.id
    assert member_permission.status is KnowledgeFSControlSpacePermissionStatus.REVOKED
    assert revision.membership_epoch == 1
    assert revision.space_acl_epoch == 1
    assert command is not None
    assert command.command_payload["reason_code"] == "workspace_membership_removed"
    assert (
        sqlite_session.scalar(
            select(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == tenant.id,
                TenantAccountJoin.account_id == member.id,
            )
        )
        is None
    )


def _workspace_accounts(
    session: Session,
    *,
    include_member: bool = True,
    member_role: TenantAccountRole = TenantAccountRole.NORMAL,
) -> tuple[Tenant, Account, Account]:
    tenant = Tenant(name="KnowledgeFS membership workspace")
    owner = Account(name="Owner", email="kfs-owner@example.com")
    member = Account(name="Member", email="kfs-member@example.com")
    session.add_all([tenant, owner, member])
    session.flush()
    session.add(TenantAccountJoin(tenant_id=tenant.id, account_id=owner.id, role=TenantAccountRole.OWNER))
    if include_member:
        session.add(TenantAccountJoin(tenant_id=tenant.id, account_id=member.id, role=member_role))
    session.commit()
    return tenant, owner, member


def _space(
    tenant: Tenant,
    owner_account_id: str,
    *,
    suffix: str = "1",
) -> KnowledgeFSControlSpace:
    return KnowledgeFSControlSpace(
        tenant_id=tenant.id,
        owner_account_id=owner_account_id,
        provisioning_key=f"membership-account-integration-{suffix}",
        knowledge_space_id=f"10000000-0000-4000-8000-00000000000{suffix}",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )


def _audit(
    tenant: Tenant,
    space: KnowledgeFSControlSpace,
    account_id: str,
    suffix: str,
) -> KnowledgeFSCapabilityIssuanceAudit:
    grant_id = f"20000000-0000-4000-8000-00000000000{suffix}"
    return KnowledgeFSCapabilityIssuanceAudit(
        tenant_id=tenant.id,
        control_space_id=space.id,
        trace_id=f"trace-membership-{suffix}",
        jti_hash=f"sha256:{sha256(grant_id.encode()).hexdigest()}",
        claims_summary={
            "caller_kind": "interactive",
            "grant_id": grant_id,
            "subject": f"dify-account:{account_id}",
        },
    )
