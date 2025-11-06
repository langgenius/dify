import os
import sys


def is_db_command():
    if len(sys.argv) > 1 and sys.argv[0].endswith("flask") and sys.argv[1] == "db":
        return True
    return False


# create app
celery = None
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
    celery = flask_app.extensions["celery"]

if __name__ == "__main__":
    from gevent import pywsgi
    from geventwebsocket.handler import WebSocketHandler

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 5001))
    server = pywsgi.WSGIServer((host, port), socketio_app, handler_class=WebSocketHandler)
    server.serve_forever()
