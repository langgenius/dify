from events.app_event import app_was_deleted
from extensions.ext_database import db
from models.model import InstalledApp


@app_was_deleted.connect
def handle(sender, **kwargs):
    app = sender
    installed_apps = db.session.query(InstalledApp).filter(InstalledApp.app_id == app.id).all()
    for installed_app in installed_apps:
        db.session.delete(installed_app)
    db.session.commit()
