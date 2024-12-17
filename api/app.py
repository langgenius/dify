from libs import version_utils

# preparation before creating app
version_utils.check_supported_python_version()


def is_db_command():
    import sys

    if len(sys.argv) > 1 and sys.argv[0].endswith("flask") and sys.argv[1] == "db":
        return True
    return False


# create app
if is_db_command():
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
