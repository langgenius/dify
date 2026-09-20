"""Build persisted test identities through the account application services."""

from sqlalchemy.orm import Session

from extensions.ext_application_services import application_services
from models.account import Account, Tenant, TenantAccountRole


def create_account(
    *, email: str, name: str, interface_language: str, session: Session, password: str | None = None
) -> Account:
    snapshot = application_services().accounts.lifecycle.create_account(
        email, name, interface_language, password=password
    )
    account = session.get(Account, snapshot.id)
    assert account is not None
    return account


def create_owner_workspace(account: Account, name: str | None = None, *, session: Session) -> None:
    """Seed a test identity even when self-service workspace creation is disabled."""
    application_services().workspaces.provisioning.create_owner_workspace(
        account.id, name=name, is_setup=True, if_missing=True
    )
    memberships = application_services().workspaces.management.list_memberships(account.id)
    assert memberships
    account.set_tenant_id_with_session(memberships[0].id, session=session)


def create_workspace(*, name: str, session: Session) -> Tenant:
    workspace = application_services().workspaces.provisioning.create(name=name)
    tenant = session.get(Tenant, workspace.id)
    assert tenant is not None
    return tenant


def join_workspace(tenant: Tenant, account: Account, session: Session, role: str) -> None:
    application_services().workspaces.members.join_member(
        workspace_id=tenant.id,
        account_id=account.id,
        email=account.email,
        role=TenantAccountRole(role),
        operator_account_id=None,
    )
    session.expire_all()
