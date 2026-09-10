from datetime import datetime

from sqlalchemy.orm import Session, sessionmaker

from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from repositories.workspace_member_query_repository import WorkspaceMemberQueryRepository
from services.workspace_member_query_service import WorkspaceMemberRecord


def make_account(
    account_id: str,
    *,
    status: AccountStatus,
    created_at: datetime,
) -> Account:
    account = Account(
        name=f"Member {account_id}",
        email=f"{account_id}@example.com",
        avatar=f"{account_id}.png",
        status=status,
    )
    account.id = account_id
    account.last_login_at = created_at
    account.last_active_at = created_at
    account.created_at = created_at
    return account


def make_tenant(tenant_id: str) -> Tenant:
    tenant = Tenant(name=f"Workspace {tenant_id}")
    tenant.id = tenant_id
    return tenant


def test_list_for_workspace_uses_join_membership_and_preserves_account_lifecycle(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    created_at = datetime(2026, 1, 1)
    active = make_account("active", status=AccountStatus.ACTIVE, created_at=created_at)
    uninitialized = make_account("uninitialized", status=AccountStatus.UNINITIALIZED, created_at=created_at)
    pending = make_account("pending", status=AccountStatus.PENDING, created_at=created_at)
    banned = make_account("banned", status=AccountStatus.BANNED, created_at=created_at)
    closed = make_account("closed", status=AccountStatus.CLOSED, created_at=created_at)
    other_workspace_member = make_account("other", status=AccountStatus.ACTIVE, created_at=created_at)
    unjoined = make_account("unjoined", status=AccountStatus.ACTIVE, created_at=created_at)
    workspace = make_tenant("workspace-1")
    other_workspace = make_tenant("workspace-2")

    with sqlite_session_factory() as session:
        session.add_all(
            [
                workspace,
                other_workspace,
                active,
                uninitialized,
                pending,
                banned,
                closed,
                other_workspace_member,
                unjoined,
                TenantAccountJoin(
                    tenant_id=workspace.id,
                    account_id=active.id,
                    role=TenantAccountRole.OWNER,
                ),
                TenantAccountJoin(
                    tenant_id=workspace.id,
                    account_id=uninitialized.id,
                    role=TenantAccountRole.NORMAL,
                ),
                TenantAccountJoin(
                    tenant_id=workspace.id,
                    account_id=pending.id,
                    role=TenantAccountRole.NORMAL,
                ),
                TenantAccountJoin(
                    tenant_id=workspace.id,
                    account_id=banned.id,
                    role=TenantAccountRole.ADMIN,
                ),
                TenantAccountJoin(
                    tenant_id=workspace.id,
                    account_id=closed.id,
                    role=TenantAccountRole.EDITOR,
                ),
                TenantAccountJoin(
                    tenant_id=other_workspace.id,
                    account_id=other_workspace_member.id,
                    role=TenantAccountRole.ADMIN,
                ),
            ]
        )
        session.commit()

    result = WorkspaceMemberQueryRepository(sqlite_session_factory).list_for_workspace(workspace.id)

    by_id = {member.id: member for member in result}
    assert set(by_id) == {"active", "uninitialized", "pending", "banned", "closed"}
    assert by_id["active"] == WorkspaceMemberRecord(
        id=active.id,
        name=active.name,
        email=active.email,
        avatar=active.avatar,
        last_login_at=created_at,
        last_active_at=created_at,
        created_at=created_at,
        status=AccountStatus.ACTIVE.value,
        legacy_role=TenantAccountRole.OWNER.value,
    )
    assert by_id["uninitialized"].status == AccountStatus.UNINITIALIZED.value
    assert by_id["pending"].status == AccountStatus.PENDING.value
    assert by_id["pending"].legacy_role == TenantAccountRole.NORMAL.value
    assert by_id["banned"].status == AccountStatus.BANNED.value
    assert by_id["closed"].status == AccountStatus.CLOSED.value


def test_list_for_workspace_returns_empty_tuple_without_membership(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory() as session:
        session.add(make_tenant("workspace-1"))
        session.commit()

    result = WorkspaceMemberQueryRepository(sqlite_session_factory).list_for_workspace("workspace-1")

    assert result == ()
