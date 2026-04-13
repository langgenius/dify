from core.db.session_factory import configure_session_factory
from extensions.ext_database import db


def init_app(app):
    with app.app_context():
        configure_session_factory(db.engine)
