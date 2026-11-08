from sqlalchemy.orm import Session

from events.app_event import app_was_created
from services.app_creation_records import create_installed_app_record


@app_was_created.connect
def handle(sender, *, session: Session | None = None, created_records_initialized: bool = False, **kwargs) -> None:
    """Create the installation in the caller's transaction unless it was already initialized."""
    if created_records_initialized:
        return
    if session is None:
        raise TypeError("session is required to initialize app creation records")
    app = sender
    create_installed_app_record(app=app, session=session)
