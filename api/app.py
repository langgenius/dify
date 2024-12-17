import sys

from libs import version_utils

# preparation before creating app
version_utils.check_supported_python_version()

# create app
if "db" in sys.argv:
    from app_factory import create_migrations_app

    app = create_migrations_app()
else:
    from app_factory import create_app
    from libs import threadings_utils

    threadings_utils.apply_gevent_threading_patch()

    app = create_app()
    celery = app.extensions["celery"]

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
