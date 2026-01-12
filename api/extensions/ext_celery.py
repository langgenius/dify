import ssl
from datetime import timedelta
from typing import Any

import pytz
from celery import Celery, Task
from celery.schedules import crontab

from configs import dify_config
from dify_app import DifyApp


def _get_celery_ssl_options() -> dict[str, Any] | None:
    """Get SSL configuration for Celery broker/backend connections."""
    # Only apply SSL if we're using Redis as broker/backend
    if not dify_config.BROKER_USE_SSL:
        return None

    # Check if Celery is actually using Redis
    broker_is_redis = dify_config.CELERY_BROKER_URL and (
        dify_config.CELERY_BROKER_URL.startswith("redis://") or dify_config.CELERY_BROKER_URL.startswith("rediss://")
    )

    if not broker_is_redis:
        return None

    # Map certificate requirement strings to SSL constants
    cert_reqs_map = {
        "CERT_NONE": ssl.CERT_NONE,
        "CERT_OPTIONAL": ssl.CERT_OPTIONAL,
        "CERT_REQUIRED": ssl.CERT_REQUIRED,
    }

    ssl_cert_reqs = cert_reqs_map.get(dify_config.REDIS_SSL_CERT_REQS, ssl.CERT_NONE)

    ssl_options = {
        "ssl_cert_reqs": ssl_cert_reqs,
        "ssl_ca_certs": dify_config.REDIS_SSL_CA_CERTS,
        "ssl_certfile": dify_config.REDIS_SSL_CERTFILE,
        "ssl_keyfile": dify_config.REDIS_SSL_KEYFILE,
    }

    return ssl_options


def init_app(app: DifyApp) -> Celery:
    class FlaskTask(Task):
        def __call__(self, *args: object, **kwargs: object) -> object:
            from core.logging.context import init_request_context

            with app.app_context():
                # Initialize logging context for this task (similar to before_request in Flask)
                init_request_context()
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
    )

    celery_app.conf.update(
        result_backend=dify_config.CELERY_RESULT_BACKEND,
        broker_transport_options=broker_transport_options,
        broker_connection_retry_on_startup=True,
        worker_log_format=dify_config.LOG_FORMAT,
        worker_task_log_format=dify_config.LOG_FORMAT,
        worker_hijack_root_logger=False,
        timezone=pytz.timezone(dify_config.LOG_TZ or "UTC"),
        task_ignore_result=True,
    )

    # Apply SSL configuration if enabled
    ssl_options = _get_celery_ssl_options()
    if ssl_options:
        celery_app.conf.update(
            broker_use_ssl=ssl_options,
            # Also apply SSL to the backend if it's Redis
            redis_backend_use_ssl=ssl_options if dify_config.CELERY_BACKEND == "redis" else None,
        )

    if dify_config.LOG_FILE:
        celery_app.conf.update(
            worker_logfile=dify_config.LOG_FILE,
        )

    celery_app.set_default()
    app.extensions["celery"] = celery_app

    imports = [
        "tasks.async_workflow_tasks",  # trigger workers
        "tasks.trigger_processing_tasks",  # async trigger processing
    ]
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
            "schedule": timedelta(minutes=dify_config.QUEUE_MONITOR_INTERVAL or 30),
        }
    if dify_config.ENABLE_CHECK_UPGRADABLE_PLUGIN_TASK and dify_config.MARKETPLACE_ENABLED:
        imports.append("schedule.check_upgradable_plugin_task")
        imports.append("tasks.process_tenant_plugin_autoupgrade_check_task")
        beat_schedule["check_upgradable_plugin_task"] = {
            "task": "schedule.check_upgradable_plugin_task.check_upgradable_plugin_task",
            "schedule": crontab(minute="*/15"),
        }
    if dify_config.WORKFLOW_LOG_CLEANUP_ENABLED:
        # 2:00 AM every day
        imports.append("schedule.clean_workflow_runlogs_precise")
        beat_schedule["clean_workflow_runlogs_precise"] = {
            "task": "schedule.clean_workflow_runlogs_precise.clean_workflow_runlogs_precise",
            "schedule": crontab(minute="0", hour="2"),
        }
    if dify_config.ENABLE_WORKFLOW_RUN_CLEANUP_TASK:
        # for saas only
        imports.append("schedule.clean_workflow_runs_task")
        beat_schedule["clean_workflow_runs_task"] = {
            "task": "schedule.clean_workflow_runs_task.clean_workflow_runs_task",
            "schedule": crontab(minute="0", hour="0"),
        }
    if dify_config.ENABLE_WORKFLOW_SCHEDULE_POLLER_TASK:
        imports.append("schedule.workflow_schedule_task")
        beat_schedule["workflow_schedule_task"] = {
            "task": "schedule.workflow_schedule_task.poll_workflow_schedules",
            "schedule": timedelta(minutes=dify_config.WORKFLOW_SCHEDULE_POLLER_INTERVAL),
        }
    if dify_config.ENABLE_TRIGGER_PROVIDER_REFRESH_TASK:
        imports.append("schedule.trigger_provider_refresh_task")
        beat_schedule["trigger_provider_refresh"] = {
            "task": "schedule.trigger_provider_refresh_task.trigger_provider_refresh",
            "schedule": timedelta(minutes=dify_config.TRIGGER_PROVIDER_REFRESH_INTERVAL),
        }
    celery_app.conf.update(beat_schedule=beat_schedule, imports=imports)

    return celery_app
