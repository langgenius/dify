from app_factory import create_app
from libs import threadings_utils, version_utils

# preparation before creating app
version_utils.check_supported_python_version()
threadings_utils.apply_gevent_threading_patch()

# create app
app = create_app()
celery = app.extensions["celery"]

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
