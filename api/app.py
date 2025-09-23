import sys
from typing import Optional

from asgiref.wsgi import WsgiToAsgi


def is_db_command():
    if len(sys.argv) > 1 and sys.argv[0].endswith("flask") and sys.argv[1] == "db":
        return True
    return False


# create app
asgi_app: WsgiToAsgi | None = None

if is_db_command():
    from app_factory import create_migrations_app

    app = create_migrations_app()
    asgi_app = WsgiToAsgi(app)
else:
    from app_factory import create_app

    app = create_app()
    celery = app.extensions["celery"]
    asgi_app = WsgiToAsgi(app)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
