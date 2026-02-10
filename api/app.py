import sys


def is_db_command() -> bool:
    if len(sys.argv) > 1 and sys.argv[0].endswith("flask") and sys.argv[1] == "db":
        return True
    return False


# create app
if is_db_command():
    from app_factory import create_migrations_app

    app = create_migrations_app()
else:
    # Gunicorn and Celery handle monkey patching automatically in production by
    # specifying the `gevent` worker class. Manual monkey patching is not required here.
    #
    # See `api/docker/entrypoint.sh` (lines 33 and 47) for details.
    #
    # For third-party library patching, refer to `gunicorn.conf.py` and `celery_entrypoint.py`.

    from app_factory import create_app

    app = create_app()
    celery = app.extensions["celery"]

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
