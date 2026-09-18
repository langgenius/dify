"""Store the Builder's proposed app name (spec N1).

The seam between the model's proposal and the app row. Strictly best-effort: a
build that is going fine must not fail because a cosmetic rename did, so every
failure is logged and swallowed and the app keeps its derived name.
"""

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder import naming
from extensions.ext_database import db
from models.model import App
from services.app_service import AppService

logger = logging.getLogger(__name__)


def rename_app_from_proposal(*, app_id: str, tenant_id: str, account_id: str, proposed: str) -> str:
    """Store ``proposed`` as the app's name if usable; return what the app is now called.

    Returns "" when nothing was stored, so the caller never records a name the
    database does not have. Never raises. Opens its own session: this runs in
    the Celery advance task, outside any Flask request.
    """
    name = naming.normalize_proposed_name(proposed)
    if not name:
        return ""
    try:
        factory = sessionmaker(bind=db.engine, expire_on_commit=False)
        with factory() as session:
            app = _load_app(session, app_id=app_id, tenant_id=tenant_id)
            if app is None:
                return ""
            if app.name == name:
                return name
            AppService().rename_app(app, name, account_id=account_id, session=session)
            return name
    except Exception:
        # The app keeps its derived name; the card keeps its generic title.
        logger.warning("dify_builder: renaming app %s failed; keeping the derived name", app_id, exc_info=True)
        return ""


def current_app_name(*, app_id: str, tenant_id: str) -> str:
    """The app's stored name, or "" if it cannot be read. Never raises.

    Seeds the Builder context so the build-complete card can name the app
    (spec N4) without the engine reaching for the database itself.
    """
    try:
        factory = sessionmaker(bind=db.engine, expire_on_commit=False)
        with factory() as session:
            app = _load_app(session, app_id=app_id, tenant_id=tenant_id)
            return app.name if app is not None else ""
    except Exception:
        logger.warning("dify_builder: reading the name of app %s failed", app_id, exc_info=True)
        return ""


def _load_app(session: Session, *, app_id: str, tenant_id: str) -> App | None:
    # Tenant-scoped: the actor's tenant is the only authority this path carries,
    # so a cross-tenant id must find nothing rather than rename.
    return session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id))
