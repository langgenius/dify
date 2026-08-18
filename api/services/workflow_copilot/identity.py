"""Actor -> account resolution and tenant-scoped app loading.

These helpers do NO authorization of their own -- they only resolve rows by
primary key (and, for ``load_app``, assert the row belongs to the calling
``Actor``'s tenant). RBAC/permission checks happen at the controller layer
before a copilot ``Advance`` ever reaches here; ``load_app``'s tenant guard
is a defense-in-depth "don't leak another tenant's app" check, not a
substitute for real authorization.
"""

from sqlalchemy.orm import Session

from core.workflow_copilot.errors import NotFoundError
from core.workflow_copilot.models import Actor
from models.account import Account
from models.model import App


def resolve_account(session: Session, actor: Actor) -> Account:
    """Look up the ``Account`` behind ``actor.account_id``.

    Raises ``NotFoundError`` if no such account exists.
    """
    account = session.get(Account, actor.account_id)
    if account is None:
        raise NotFoundError(f"account not found: {actor.account_id}")
    return account


def load_app(session: Session, app_id: str, actor: Actor) -> App:
    """Look up the ``App`` for ``app_id``, scoped to ``actor``'s tenant.

    Raises ``NotFoundError`` if the app doesn't exist, and -- to avoid
    leaking an app's existence to a caller from another tenant -- also
    raises ``NotFoundError`` (not a distinct permission error) when the
    app belongs to a different tenant than ``actor.tenant_id``. This
    mirrors the P1 usecase's non-owner-to-NotFoundError convention.
    """
    app = session.get(App, app_id)
    if app is None:
        raise NotFoundError(f"app not found: {app_id}")
    if app.tenant_id != actor.tenant_id:
        raise NotFoundError(f"app not found: {app_id}")
    return app
