from flask import Flask

from server.basic_assembly import BasicAssembly


class ExtensionsAssembly(BasicAssembly):
    def prepare_app(self, app: Flask):
        initialize_extensions(app)


def initialize_extensions(app: Flask):
    from extensions import (
        ext_app_metrics,
        ext_celery,
        ext_code_based_extension,
        ext_compress,
        ext_database,
        ext_hosting_provider,
        ext_login,
        ext_mail,
        ext_migrate,
        ext_proxy_fix,
        ext_redis,
        ext_sentry,
        ext_storage,
    )
    from extensions.ext_database import db

    # Since the application instance is now created, pass it to each Flask
    # extension instance to bind it to the Flask application instance (app)
    ext_compress.init_app(app)
    ext_code_based_extension.init()
    ext_database.init_app(app)
    ext_app_metrics.init_app(app)
    ext_migrate.init(app, db)
    ext_redis.init_app(app)
    ext_storage.init_app(app)
    ext_celery.init_app(app)
    ext_login.init_app(app)
    ext_mail.init_app(app)
    ext_hosting_provider.init_app(app)
    ext_sentry.init_app(app)
    ext_proxy_fix.init_app(app)
