"""Read the existing Dify app name for the Builder session."""


import logging

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_database import db
from models.model import App

logger = logging.getLogger(__name__)


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
