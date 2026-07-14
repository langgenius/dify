from sqlalchemy.orm import Session

from events.app_event import app_was_created
from models.model import InstalledApp


@app_was_created.connect
def handle(sender, *, session: Session, **_kwargs) -> None:
    """Create an installed app when an app is created."""
    app = sender
    installed_app = InstalledApp(
        tenant_id=app.tenant_id,
        app_id=app.id,
        app_owner_tenant_id=app.tenant_id,
    )
    session.add(installed_app)
    session.flush()
