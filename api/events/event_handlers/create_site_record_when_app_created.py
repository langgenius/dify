from sqlalchemy.orm import Session

from events.app_event import app_was_created
from services.app_creation_records import create_site_record


@app_was_created.connect
def handle(sender, *, session: Session, **kwargs) -> None:
    """Create site record when an app is created."""
    if kwargs.get("created_records_initialized"):
        return
    app = sender
    account = kwargs.get("account")
    if account is not None:
        create_site_record(app=app, account=account, session=session)
