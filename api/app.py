import os
import sys

import dotenv


def is_db_command():
    if len(sys.argv) > 1 and sys.argv[0].endswith("flask") and sys.argv[1] == "db":
        return True
    return False


def setup_gevent():
    # It seems that JetBrains Python debugger does not work well with gevent,
    # so we need to disable gevent in debug mode.
    # If you are using debugpy and set GEVENT_SUPPORT=True, you can debug with gevent.
    dotenv.load_dotenv()
    flask_debug = os.environ.get("FLASK_DEBUG", "0")
    gevent_disable = os.environ.get("GEVENT_DISABLE", "false").lower() in {"true", "1", "yes"}
    if flask_debug.lower() in {"false", "0", "no"} and not gevent_disable:
        from gevent import monkey

        # gevent
        monkey.patch_all()

        from grpc.experimental import gevent as grpc_gevent  # type: ignore

        # grpc gevent
        grpc_gevent.init_gevent()

        import psycogreen.gevent  # type: ignore

        psycogreen.gevent.patch_psycopg()


# create app
if is_db_command():
    from app_factory import create_migrations_app

    app = create_migrations_app()
else:
    setup_gevent()

    from app_factory import create_app

    app = create_app()
    celery = app.extensions["celery"]

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
