from datetime import timedelta

from celery import Celery, Task
from flask import Flask


def init_app(app: Flask) -> Celery:
    class FlaskTask(Task):
        def __call__(self, *args: object, **kwargs: object) -> object:
            with app.app_context():
                return self.run(*args, **kwargs)

    broker_transport_options = {}

    if app.config.get("CELERY_USE_SENTINEL"):
        broker_transport_options = {
            "master_name": app.config.get("CELERY_SENTINEL_MASTER_NAME"),
            "sentinel_kwargs": {
                "socket_timeout": app.config.get("CELERY_SENTINEL_SOCKET_TIMEOUT", 0.1),
            },
        }

    celery_app = Celery(
        app.name,
        task_cls=FlaskTask,
        broker=app.config.get("CELERY_BROKER_URL"),
        backend=app.config.get("CELERY_BACKEND"),
        task_ignore_result=True,
    )

    # Add SSL options to the Celery configuration
    ssl_options = {
        "ssl_cert_reqs": None,
        "ssl_ca_certs": None,
        "ssl_certfile": None,
        "ssl_keyfile": None,
    }

    celery_app.conf.update(
        result_backend=app.config.get("CELERY_RESULT_BACKEND"),
        broker_transport_options=broker_transport_options,
        broker_connection_retry_on_startup=True,
    )

    if app.config.get("BROKER_USE_SSL"):
        celery_app.conf.update(
            broker_use_ssl=ssl_options,  # Add the SSL options to the broker configuration
        )

    celery_app.set_default()
    app.extensions["celery"] = celery_app

    imports = [
        "schedule.clean_embedding_cache_task",
        "schedule.clean_unused_datasets_task",
    ]
    day = app.config.get("CELERY_BEAT_SCHEDULER_TIME")
    beat_schedule = {
        "clean_embedding_cache_task": {
            "task": "schedule.clean_embedding_cache_task.clean_embedding_cache_task",
            "schedule": timedelta(days=day),
        },
        "clean_unused_datasets_task": {
            "task": "schedule.clean_unused_datasets_task.clean_unused_datasets_task",
            "schedule": timedelta(days=day),
        },
    }
    celery_app.conf.update(beat_schedule=beat_schedule, imports=imports)

    return celery_app
