from datetime import timedelta

from celery import Celery, Task
from flask import Flask


def init_app(app: Flask) -> Celery:
    class FlaskTask(Task):
        def __call__(self, *args: object, **kwargs: object) -> object:
            with app.app_context():
                return self.run(*args, **kwargs)

    celery_app = Celery(
        app.name,
        task_cls=FlaskTask,
        broker=app.config["CELERY_BROKER_URL"],
        backend=app.config["CELERY_BACKEND"],
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
        result_backend=app.config["CELERY_RESULT_BACKEND"],
        broker_connection_retry_on_startup=True,
    )

    if app.config["BROKER_USE_SSL"]:
        celery_app.conf.update(
            broker_use_ssl=ssl_options,  # Add the SSL options to the broker configuration
        )
        
    celery_app.set_default()
    app.extensions["celery"] = celery_app

    imports = [
        "schedule.clean_embedding_cache_task",
        "schedule.clean_unused_datasets_task",
    ]

    beat_schedule = {
        'clean_embedding_cache_task': {
            'task': 'schedule.clean_embedding_cache_task.clean_embedding_cache_task',
            'schedule': timedelta(days=1),
        },
        'clean_unused_datasets_task': {
            'task': 'schedule.clean_unused_datasets_task.clean_unused_datasets_task',
            'schedule': timedelta(days=1),
        }
    }
    celery_app.conf.update(
        beat_schedule=beat_schedule,
        imports=imports
    )

    return celery_app
