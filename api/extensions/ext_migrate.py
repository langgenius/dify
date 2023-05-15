import flask_migrate


def init(app, db):
    flask_migrate.Migrate(app, db)
