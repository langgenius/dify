import flask_migrate  # type: ignore


def init(app, db):
    flask_migrate.Migrate(app, db)
