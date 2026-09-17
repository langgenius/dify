from sqlalchemy.orm import Session, sessionmaker

from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from repositories.workspace_query_repository import WorkspaceQueryRepository

_WORKSPACE_ID = "11111111-1111-1111-1111-111111111111"
_OTHER_WORKSPACE_ID = "22222222-2222-2222-2222-222222222222"
_OWNER_ID = "33333333-3333-3333-3333-333333333333"
_ADMIN_ID = "44444444-4444-4444-4444-444444444444"
_OTHER_WORKSPACE_ACCOUNT_ID = "55555555-5555-5555-5555-555555555555"


def _account(account_id: str) -> Account:
    account = Account(name=f"Account {account_id}", email=f"{account_id}@example.com")
    account.id = account_id
    return account


def test_get_role_for_account_is_scoped_by_workspace_and_account(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    workspace = Tenant(name="Workspace")
    workspace.id = _WORKSPACE_ID
    other_workspace = Tenant(name="Other workspace")
    other_workspace.id = _OTHER_WORKSPACE_ID
    with sqlite_session_factory() as session:
        session.add_all(
            [
                workspace,
                other_workspace,
                _account(_OWNER_ID),
                _account(_ADMIN_ID),
                _account(_OTHER_WORKSPACE_ACCOUNT_ID),
                TenantAccountJoin(
                    tenant_id=_WORKSPACE_ID,
                    account_id=_OWNER_ID,
                    role=TenantAccountRole.OWNER,
                ),
                TenantAccountJoin(
                    tenant_id=_WORKSPACE_ID,
                    account_id=_ADMIN_ID,
                    role=TenantAccountRole.ADMIN,
                ),
                TenantAccountJoin(
                    tenant_id=_OTHER_WORKSPACE_ID,
                    account_id=_OTHER_WORKSPACE_ACCOUNT_ID,
                    role=TenantAccountRole.OWNER,
                ),
            ]
        )
        session.commit()

    repository = WorkspaceQueryRepository(sqlite_session_factory)

    assert repository.get_role_for_account(workspace_id=_WORKSPACE_ID, account_id=_OWNER_ID) == "owner"
    assert repository.get_role_for_account(workspace_id=_WORKSPACE_ID, account_id=_ADMIN_ID) == "admin"
    assert repository.get_role_for_account(workspace_id=_WORKSPACE_ID, account_id="missing-account") is None
    assert repository.get_role_for_account(workspace_id=_WORKSPACE_ID, account_id=_OTHER_WORKSPACE_ACCOUNT_ID) is None
