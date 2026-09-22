"""Database records required for a newly created App."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Account
from models.enums import CustomizeTokenStrategy
from models.model import App, InstalledApp, Site


def create_site_record(*, app: App, account: Account, session: Session) -> None:
    site = Site(
        app_id=app.id,
        title=app.name,
        icon_type=app.icon_type,
        icon=app.icon,
        icon_background=app.icon_background,
        default_language=account.interface_language or "en-US",
        customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
        code=Site.generate_code(16, session=session),
        created_by=app.created_by,
        updated_by=app.updated_by,
    )
    session.add(site)
    session.flush()


def create_installed_app_record(*, app: App, session: Session) -> None:
    installed_app_id = session.scalar(
        select(InstalledApp.id).where(InstalledApp.tenant_id == app.tenant_id, InstalledApp.app_id == app.id).limit(1)
    )
    if installed_app_id:
        return

    session.add(
        InstalledApp(
            tenant_id=app.tenant_id,
            app_id=app.id,
            app_owner_tenant_id=app.tenant_id,
        )
    )
    session.flush()


__all__ = ["create_installed_app_record", "create_site_record"]
