from sqlalchemy.orm import Session

from events.app_event import app_was_created
from services.app_creation_records import create_site_record


@app_was_created.connect
def handle(sender, *, session: Session | None = None, created_records_initialized: bool = False, **kwargs) -> None:
    """Create the site in the caller's transaction unless it was already initialized."""
    if created_records_initialized:
        return
    if session is None:
        raise TypeError("session is required to initialize app creation records")
    app = sender
    account = kwargs.get("account")
    if account is not None:
        create_site_record(app=app, account=account, session=session)
