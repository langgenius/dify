from sqlalchemy.orm import Session

from events.app_event import app_was_created
from services.app_creation_records import create_installed_app_record


@app_was_created.connect
def handle(sender, *, session: Session, **kwargs) -> None:
    """Create an installed app when an app is created."""
    if kwargs.get("created_records_initialized"):
        return
    app = sender
    create_installed_app_record(app=app, session=session)
