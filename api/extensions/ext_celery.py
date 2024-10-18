from datetime import timedelta
from celery.schedules import crontab
from celery import Celery, Task
from flask import Flask
from configs import dify_config

def init_app(app: Flask) -> Celery:
    class FlaskTask(Task):
        def __call__(self, *args: object, **kwargs: object) -> object:
            with app.app_context():
                return self.run(*args, **kwargs)

    broker_transport_options = {}

    if dify_config.CELERY_USE_SENTINEL:
        broker_transport_options = {
            "master_name": dify_config.CELERY_SENTINEL_MASTER_NAME,
            "sentinel_kwargs": {
                "socket_timeout": dify_config.CELERY_SENTINEL_SOCKET_TIMEOUT,
            },
        }

    celery_app = Celery(
        app.name,
        task_cls=FlaskTask,
        broker=dify_config.CELERY_BROKER_URL,
        backend=dify_config.CELERY_BACKEND,
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
        result_backend=dify_config.CELERY_RESULT_BACKEND,
        broker_transport_options=broker_transport_options,
        broker_connection_retry_on_startup=True,
    )

    if dify_config.BROKER_USE_SSL:
        celery_app.conf.update(
            broker_use_ssl=ssl_options,  # Add the SSL options to the broker configuration
        )

    celery_app.set_default()
    app.extensions["celery"] = celery_app

    schedule = get_schedule(app.config)

    imports = [
        "schedule.clean_embedding_cache_task",
        "schedule.clean_unused_datasets_task",
    ]

    beat_schedule = {
        "clean_embedding_cache_task": {
            "task": "schedule.clean_embedding_cache_task.clean_embedding_cache_task",
            "schedule": schedule,
        },
        "clean_unused_datasets_task": {
            "task": "schedule.clean_unused_datasets_task.clean_unused_datasets_task",
            "schedule": schedule,
        },
    }
    celery_app.conf.update(beat_schedule=beat_schedule, imports=imports)

    return celery_app


def get_schedule(app_config):
    """Determine the schedule type based on configuration."""

    # Fetch configuration values
    scheduler_type = dify_config.CELERY_BEAT_SCHEDULER_TYPE  # Options: 'time' or 'cron'
    day = dify_config.CELERY_BEAT_SCHEDULER_TIME
    cron_expression = dify_config.CELERY_BEAT_SCHEDULER_CRON_EXPRESSION

    # Determine the schedule based on the 'scheduler_type' value using match-case
    match scheduler_type:
        case "cron":
            if not cron_expression:
                raise ValueError(
                    "Configuration Error: 'CELERY_BEAT_SCHEDULER_CRON_EXPRESSION' is required when using the 'cron' scheduler type.")
            try:
                minute, hour, day_of_month, month_of_year, day_of_week = cron_expression.split()
            except ValueError:
                raise ValueError(
                    "Format Error: 'CELERY_BEAT_SCHEDULER_CRON_EXPRESSION' must contain exactly five fields separated by spaces.")
            schedule = crontab(
                minute=minute,
                hour=hour,
                day_of_month=day_of_month,
                month_of_year=month_of_year,
                day_of_week=day_of_week
            )
        case "time":
            if day is None:
                raise ValueError(
                    "Configuration Error: 'CELERY_BEAT_SCHEDULER_TIME' is required when using the 'time' scheduler type.")
            schedule = timedelta(days=day)
        case _:
            raise ValueError(
                "Configuration Error: 'CELERY_BEAT_SCHEDULER_TYPE' must be set to either 'time' or 'cron'.")

    return schedule
