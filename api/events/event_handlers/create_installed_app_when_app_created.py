from sqlalchemy import select
from sqlalchemy.orm import Session

from events.app_event import app_was_created
from models.model import InstalledApp


@app_was_created.connect
def handle(sender, *, session: Session, **_kwargs) -> None:
    """Create an installed app when an app is created."""
    app = sender
    installed_app_id = session.scalar(
        select(InstalledApp.id).where(InstalledApp.tenant_id == app.tenant_id, InstalledApp.app_id == app.id).limit(1)
    )
    if installed_app_id:
        return

    installed_app = InstalledApp(
        tenant_id=app.tenant_id,
        app_id=app.id,
        app_owner_tenant_id=app.tenant_id,
    )
    session.add(installed_app)
    session.flush()
