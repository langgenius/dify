import os
import sys


def is_db_command():
    if len(sys.argv) > 1 and sys.argv[0].endswith("flask") and sys.argv[1] == "db":
        return True
    return False


# create app
if is_db_command():
    from app_factory import create_migrations_app

    app = create_migrations_app()
else:
    if os.environ.get("FLASK_DEBUG", "False") != "True":
        from gevent import monkey  # type: ignore

        # gevent
        monkey.patch_all()

        from grpc.experimental import gevent as grpc_gevent  # type: ignore

        # grpc gevent
        grpc_gevent.init_gevent()

        import psycogreen.gevent  # type: ignore

        psycogreen.gevent.patch_psycopg()

    from app_factory import create_app

    app = create_app()
    celery = app.extensions["celery"]

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
