from datetime import datetime

from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from repositories.workspace.workspace_member_query_repository import WorkspaceMemberQueryRepository
from services.workspace.contracts import WorkspaceMemberRecord


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


def test_dataset_operators_are_filtered_by_sql_within_workspace(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine
) -> None:
    workspace = make_tenant("workspace-1")
    other = make_tenant("workspace-2")
    created_at = datetime(2026, 1, 1)
    with sqlite_session_factory.begin() as session:
        session.add_all([workspace, other])
        for account_id, tenant_id, role in [
            ("operator", workspace.id, TenantAccountRole.DATASET_OPERATOR),
            ("editor", workspace.id, TenantAccountRole.EDITOR),
            ("foreign-operator", other.id, TenantAccountRole.DATASET_OPERATOR),
        ]:
            session.add(make_account(account_id, status=AccountStatus.ACTIVE, created_at=created_at))
            session.add(TenantAccountJoin(account_id=account_id, tenant_id=tenant_id, role=role))

    queries: list[str] = []

    def capture_sql(_connection, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        queries.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", capture_sql)
    try:
        records = WorkspaceMemberQueryRepository(sqlite_session_factory).list_for_workspace(
            workspace.id, role=TenantAccountRole.DATASET_OPERATOR
        )
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", capture_sql)

    assert [record.id for record in records] == ["operator"]
    assert len(queries) == 1
    assert "tenant_account_joins.role =" in queries[0].partition("WHERE")[2]
