from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Account, App, CustomizedSnippet, TenantAccountJoin


def get_service_account_for_app(session: Session, app_id: str, tenant_id: str) -> Account:
    """Get the creator account for an app with tenant context set up.

    This follows the same pattern as BaseTraceInstance.get_service_account_with_tenant().
    """
    app = session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id))
    if not app:
        raise ValueError(f"App with id {app_id} not found")

    if not app.created_by:
        raise ValueError(f"App with id {app_id} has no creator")

    account = session.scalar(select(Account).where(Account.id == app.created_by))
    if not account:
        raise ValueError(f"Creator account not found for app {app_id}")

    tenant_membership = session.query(TenantAccountJoin).filter_by(account_id=account.id, tenant_id=tenant_id).first()
    if not tenant_membership:
        raise ValueError(f"Creator account {account.id} is not a member of tenant {tenant_id}")

    account.set_tenant_id_with_session(tenant_id, session=session)
    return account


def get_service_account_for_snippet(session: Session, snippet_id: str, tenant_id: str) -> Account:
    """Get the creator account for a snippet with tenant context set up.

    Mirrors :func:`get_service_account_for_app` but queries CustomizedSnippet.
    """
    snippet = session.scalar(
        select(CustomizedSnippet).where(
            CustomizedSnippet.id == snippet_id,
            CustomizedSnippet.tenant_id == tenant_id,
        )
    )
    if not snippet:
        raise ValueError(f"Snippet with id {snippet_id} not found")

    if not snippet.created_by:
        raise ValueError(f"Snippet with id {snippet_id} has no creator")

    account = session.scalar(select(Account).where(Account.id == snippet.created_by))
    if not account:
        raise ValueError(f"Creator account not found for snippet {snippet_id}")

    tenant_membership = session.query(TenantAccountJoin).filter_by(account_id=account.id, tenant_id=tenant_id).first()
    if not tenant_membership:
        raise ValueError(f"Creator account {account.id} is not a member of tenant {tenant_id}")

    account.set_tenant_id_with_session(tenant_id, session=session)
    return account
