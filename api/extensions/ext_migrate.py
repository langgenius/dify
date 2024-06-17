import flask_migrate


def init(app, db):
    flask_migrate.Migrate(app, db)


def db_upgrade():
    """
    Upgrade the database with Flask-Migrate
    """
    flask_migrate.upgrade()
