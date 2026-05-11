"""Application module for framework-managed Flask and Celery startup.

The supported API runtime is Gunicorn with gevent workers. This module exposes
`socketio_app`, `flask_app`, and `celery` for framework entrypoints, but
starting the server manually via `python -m app` is intentionally unsupported
because it bypasses the framework-owned gevent patch timing.
"""

from __future__ import annotations

import sys
from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:
    from celery import Celery

    celery: Celery


def is_db_command() -> bool:
    if len(sys.argv) > 1 and sys.argv[0].endswith("flask") and sys.argv[1] == "db":
        return True
    return False


# create app
flask_app = None
socketio_app = None

if is_db_command():
    from app_factory import create_migrations_app

    app = create_migrations_app()
    socketio_app = app
    flask_app = app
else:
    # Gunicorn and Celery own gevent patch timing. Third-party compatibility
    # patching is added by `gunicorn.conf.py` and `celery_entrypoint.py`.

    from app_factory import create_app

    socketio_app, flask_app = create_app()
    app = flask_app
    celery = cast("Celery", app.extensions["celery"])

if __name__ == "__main__":
    raise SystemExit("Direct API server startup via `python -m app` is unsupported. Use Gunicorn or `./dev/start-api`.")
