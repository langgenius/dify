from events.app_event import app_was_deleted
from extensions.ext_database import db
from models.model import Site


@app_was_deleted.connect
def handle(sender, **kwargs):
    app = sender
    site = db.session.query(Site).filter(Site.app_id == app.id).first()
    db.session.delete(site)
    db.session.commit()
