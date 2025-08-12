from datetime import timedelta

import pytz
from celery import Celery, Task  # type: ignore
from celery.schedules import crontab  # type: ignore

from configs import dify_config
from dify_app import DifyApp


def init_app(app: DifyApp) -> Celery:
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
                "password": dify_config.CELERY_SENTINEL_PASSWORD,
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
        worker_log_format=dify_config.LOG_FORMAT,
        worker_task_log_format=dify_config.LOG_FORMAT,
        worker_hijack_root_logger=False,
        timezone=pytz.timezone(dify_config.LOG_TZ or "UTC"),
    )

    if dify_config.BROKER_USE_SSL:
        celery_app.conf.update(
            broker_use_ssl=ssl_options,  # Add the SSL options to the broker configuration
        )

    if dify_config.LOG_FILE:
        celery_app.conf.update(
            worker_logfile=dify_config.LOG_FILE,
        )

    celery_app.set_default()
    app.extensions["celery"] = celery_app

    imports = []
    day = dify_config.CELERY_BEAT_SCHEDULER_TIME

    # if you add a new task, please add the switch to CeleryScheduleTasksConfig
    beat_schedule = {}
    if dify_config.ENABLE_CLEAN_EMBEDDING_CACHE_TASK:
        imports.append("schedule.clean_embedding_cache_task")
        beat_schedule["clean_embedding_cache_task"] = {
            "task": "schedule.clean_embedding_cache_task.clean_embedding_cache_task",
            "schedule": crontab(minute="0", hour="2", day_of_month=f"*/{day}"),
        }
    if dify_config.ENABLE_CLEAN_UNUSED_DATASETS_TASK:
        imports.append("schedule.clean_unused_datasets_task")
        beat_schedule["clean_unused_datasets_task"] = {
            "task": "schedule.clean_unused_datasets_task.clean_unused_datasets_task",
            "schedule": crontab(minute="0", hour="3", day_of_month=f"*/{day}"),
        }
    if dify_config.ENABLE_CREATE_TIDB_SERVERLESS_TASK:
        imports.append("schedule.create_tidb_serverless_task")
        beat_schedule["create_tidb_serverless_task"] = {
            "task": "schedule.create_tidb_serverless_task.create_tidb_serverless_task",
            "schedule": crontab(minute="0", hour="*"),
        }
    if dify_config.ENABLE_UPDATE_TIDB_SERVERLESS_STATUS_TASK:
        imports.append("schedule.update_tidb_serverless_status_task")
        beat_schedule["update_tidb_serverless_status_task"] = {
            "task": "schedule.update_tidb_serverless_status_task.update_tidb_serverless_status_task",
            "schedule": timedelta(minutes=10),
        }
    if dify_config.ENABLE_CLEAN_MESSAGES:
        imports.append("schedule.clean_messages")
        beat_schedule["clean_messages"] = {
            "task": "schedule.clean_messages.clean_messages",
            "schedule": crontab(minute="0", hour="4", day_of_month=f"*/{day}"),
        }
    if dify_config.ENABLE_MAIL_CLEAN_DOCUMENT_NOTIFY_TASK:
        imports.append("schedule.mail_clean_document_notify_task")
        beat_schedule["mail_clean_document_notify_task"] = {
            "task": "schedule.mail_clean_document_notify_task.mail_clean_document_notify_task",
            "schedule": crontab(minute="0", hour="10", day_of_week="1"),
        }
    if dify_config.ENABLE_DATASETS_QUEUE_MONITOR:
        imports.append("schedule.queue_monitor_task")
        beat_schedule["datasets-queue-monitor"] = {
            "task": "schedule.queue_monitor_task.queue_monitor_task",
            "schedule": timedelta(
                minutes=dify_config.QUEUE_MONITOR_INTERVAL if dify_config.QUEUE_MONITOR_INTERVAL else 30
            ),
        }
    if dify_config.ENABLE_CHECK_UPGRADABLE_PLUGIN_TASK:
        imports.append("schedule.check_upgradable_plugin_task")
        beat_schedule["check_upgradable_plugin_task"] = {
            "task": "schedule.check_upgradable_plugin_task.check_upgradable_plugin_task",
            "schedule": crontab(minute="*/15"),
        }

    celery_app.conf.update(beat_schedule=beat_schedule, imports=imports)

    return celery_app
