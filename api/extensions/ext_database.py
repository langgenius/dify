from flask_sqlalchemy import SQLAlchemy

# TODO: Check if this is the right way to do it
db = SQLAlchemy(session_options={"expire_on_commit": False})


def init_app(app):
    db.init_app(app)
