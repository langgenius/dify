from __future__ import annotations

import logging
import sys
from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:
    from celery import Celery

    celery: Celery


HOST = "0.0.0.0"
PORT = 5001
logger = logging.getLogger(__name__)


def is_db_command() -> bool:
    if len(sys.argv) > 1 and sys.argv[0].endswith("flask") and sys.argv[1] == "db":
        return True
    return False


def log_startup_banner(host: str, port: int) -> None:
    debugger_attached = sys.gettrace() is not None
    logger.info("Serving Dify API via gevent WebSocket server")
    logger.info("Bound to http://%s:%s", host, port)
    logger.info("Debugger attached: %s", "on" if debugger_attached else "off")
    logger.info("Press CTRL+C to quit")


# create app
flask_app = None
socketio_app = None

if is_db_command():
    from app_factory import create_migrations_app

    app = create_migrations_app()
    socketio_app = app
    flask_app = app
else:
    # Gunicorn and Celery handle monkey patching automatically in production by
    # specifying the `gevent` worker class. Manual monkey patching is not required here.
    #
    # See `api/docker/entrypoint.sh` (lines 33 and 47) for details.
    #
    # For third-party library patching, refer to `gunicorn.conf.py` and `celery_entrypoint.py`.

    from app_factory import create_app

    socketio_app, flask_app = create_app()
    app = flask_app
    celery = cast("Celery", app.extensions["celery"])

if __name__ == "__main__":
    from gevent import pywsgi
    from geventwebsocket.handler import WebSocketHandler  # type: ignore[reportMissingTypeStubs]

    log_startup_banner(HOST, PORT)
    server = pywsgi.WSGIServer((HOST, PORT), socketio_app, handler_class=WebSocketHandler)
    server.serve_forever()
