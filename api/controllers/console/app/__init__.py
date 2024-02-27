from flask_login import current_user
from werkzeug.exceptions import NotFound

from controllers.console.app.error import AppUnavailableError
from extensions.ext_database import db
from models.model import App


def _get_app(app_id, mode=None):
    app = db.session.query(App).filter(
        App.id == app_id,
        App.tenant_id == current_user.current_tenant_id,
        App.status == 'normal'
    ).first()

    if not app:
        raise NotFound("App not found")

    if mode and app.mode != mode:
        raise NotFound("The {} app not found".format(mode))

    return app
