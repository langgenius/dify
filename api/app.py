import os


def _setup_gevent():
    """Do gevent monkey patching.

    This function should be called as early as possible. Ideally
    it should be the first statement in the entrypoint file.

    It should be
    """
    _FALSE_VALUE_FOR_ENV = frozenset(["false", "0", "no"])
    # It seems that JetBrains Python debugger does not work well with gevent,
    # so we need to disable gevent in debug mode.
    # If you are using debugpy and set GEVENT_SUPPORT=True, you can debug with gevent.
    flask_debug_env = os.environ.get("FLASK_DEBUG", "0").lower()
    if flask_debug_env not in _FALSE_VALUE_FOR_ENV:
        print("Flask Debug enabled.", flush=True)
        return
    gevent_support_env = os.environ.get("GEVENT_SUPPORT", "false").lower()
    if gevent_support_env in _FALSE_VALUE_FOR_ENV:
        print("Gevent disabled.", flush=True)
        return

    from gevent import monkey

    # gevent
    monkey.patch_all()

    from grpc.experimental import gevent as grpc_gevent  # type: ignore

    # grpc gevent
    grpc_gevent.init_gevent()

    import psycogreen.gevent  # type: ignore

    psycogreen.gevent.patch_psycopg()
    print("Gevnet and psycopg patched", flush=True)


_setup_gevent()

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
    from app_factory import create_app

    app = create_app()
    celery = app.extensions["celery"]

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
