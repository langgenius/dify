from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Account, App, TenantAccountJoin


def get_service_account_for_app(session: Session, app_id: str) -> Account:
    """Get the creator account for an app with tenant context set up.

    This follows the same pattern as BaseTraceInstance.get_service_account_with_tenant().
    """
    app = session.scalar(select(App).where(App.id == app_id))
    if not app:
        raise ValueError(f"App with id {app_id} not found")

    if not app.created_by:
        raise ValueError(f"App with id {app_id} has no creator")

    account = session.scalar(select(Account).where(Account.id == app.created_by))
    if not account:
        raise ValueError(f"Creator account not found for app {app_id}")

    current_tenant = (
        session.query(TenantAccountJoin)
        .filter_by(account_id=account.id, current=True)
        .first()
    )
    if not current_tenant:
        raise ValueError(f"Current tenant not found for account {account.id}")

    account.set_tenant_id(current_tenant.tenant_id)
    return account
