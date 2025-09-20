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
    # It seems that JetBrains Python debugger does not work well with gevent,
    # so we need to disable gevent in debug mode.
    # If you are using debugpy and set GEVENT_SUPPORT=True, you can debug with gevent.
    # if (flask_debug := os.environ.get("FLASK_DEBUG", "0")) and flask_debug.lower() in {"false", "0", "no"}:
    # from gevent import monkey
    #
    # # gevent
    # monkey.patch_all()
    #
    # from grpc.experimental import gevent as grpc_gevent  # type: ignore
    #
    # # grpc gevent
    # grpc_gevent.init_gevent()

    # import psycogreen.gevent  # type: ignore
    #
    # psycogreen.gevent.patch_psycopg()

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
