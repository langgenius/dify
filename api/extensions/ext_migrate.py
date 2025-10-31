from dify_app import DifyApp


def init_app(app: DifyApp):
    import flask_migrate

    from extensions.ext_database import db

    flask_migrate.Migrate(app, db)
