from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from dify_app import DifyApp
from extensions.ext_celery import init_app


def test_celery_registers_initial_source_task_when_knowledge_fs_lifecycle_is_ready() -> None:
    config = MagicMock()
    config.BROKER_USE_SSL = False
    config.REDIS_KEY_PREFIX = "test"
    config.HUMAN_INPUT_TIMEOUT_TASK_INTERVAL = 1
    config.CELERY_BROKER_URL = "redis://localhost:6379/0"
    config.CELERY_BACKEND = "redis"
    config.CELERY_RESULT_BACKEND = "redis://localhost:6379/0"
    config.CELERY_USE_SENTINEL = False
    config.LOG_FORMAT = "%(message)s"
    config.LOG_TZ = "UTC"
    config.LOG_FILE = None
    config.CELERY_TASK_ANNOTATIONS = {}
    config.CELERY_BEAT_SCHEDULER_TIME = 1
    config.KNOWLEDGE_FS_LIFECYCLE_POLL_INTERVAL_SECONDS = 2
    config.ENABLE_CONVERSATION_CLEANUP_TASK = True
    config.CONVERSATION_CLEANUP_TASK_INTERVAL = 5
    config.ENABLE_CLEAN_EMBEDDING_CACHE_TASK = False
    config.ENABLE_CLEAN_UNUSED_DATASETS_TASK = False
    config.ENABLE_CREATE_TIDB_SERVERLESS_TASK = False
    config.ENABLE_UPDATE_TIDB_SERVERLESS_STATUS_TASK = False
    config.ENABLE_CLEAN_MESSAGES = False
    config.ENABLE_MAIL_CLEAN_DOCUMENT_NOTIFY_TASK = False
    config.ENABLE_DATASETS_QUEUE_MONITOR = False
    config.ENABLE_HUMAN_INPUT_TIMEOUT_TASK = False
    config.ENABLE_CHECK_UPGRADABLE_PLUGIN_TASK = False
    config.MARKETPLACE_ENABLED = False
    config.WORKFLOW_LOG_CLEANUP_ENABLED = False
    config.ENABLE_WORKFLOW_RUN_CLEANUP_TASK = False
    config.ENABLE_WORKFLOW_SCHEDULE_POLLER_TASK = False
    config.WORKFLOW_SCHEDULE_POLLER_INTERVAL = 1
    config.ENABLE_TRIGGER_PROVIDER_REFRESH_TASK = False
    config.TRIGGER_PROVIDER_REFRESH_INTERVAL = 15
    config.ENABLE_API_TOKEN_LAST_USED_UPDATE_TASK = False
    config.API_TOKEN_LAST_USED_UPDATE_INTERVAL = 30
    config.ENTERPRISE_ENABLED = False
    config.ENTERPRISE_TELEMETRY_ENABLED = False

    with (
        patch("extensions.ext_celery.dify_config", config),
        patch(
            "services.knowledge_fs.lifecycle_readiness.get_configured_knowledge_fs_lifecycle_worker_readiness",
            return_value=SimpleNamespace(ready=True),
        ),
    ):
        celery_app = init_app(DifyApp(__name__))

    assert "tasks.knowledge_fs_initial_source_tasks" in celery_app.conf["imports"]
    assert "tasks.knowledge_fs_initial_source_preview_tasks" in celery_app.conf["imports"]
    assert "tasks.knowledge_fs_failed_retrieval_tasks" in celery_app.conf["imports"]
    assert "tasks.knowledge_fs_lifecycle_tasks" in celery_app.conf["imports"]
    assert "tasks.delete_conversation_task" in celery_app.conf["imports"]
    assert celery_app.conf["beat_schedule"]["conversation_cleanup_sweeper"] == {
        "task": "tasks.delete_conversation_task.sweep_deleted_conversations",
        "schedule": timedelta(minutes=5),
    }
    assert celery_app.conf["beat_schedule"]["knowledge_fs_staged_upload_cleanup"] == {
        "task": "tasks.knowledge_fs_lifecycle_tasks.cleanup_knowledge_fs_staged_uploads",
        "schedule": timedelta(seconds=2),
    }

    with (
        patch("extensions.ext_celery.dify_config", config),
        patch(
            "services.knowledge_fs.lifecycle_readiness.get_configured_knowledge_fs_lifecycle_worker_readiness",
            return_value=SimpleNamespace(ready=False),
        ),
    ):
        preview_only_app = init_app(DifyApp(f"{__name__}.preview_only"))

    assert "tasks.knowledge_fs_initial_source_preview_tasks" in preview_only_app.conf["imports"]
    assert "tasks.knowledge_fs_failed_retrieval_tasks" in preview_only_app.conf["imports"]
    assert "tasks.knowledge_fs_initial_source_tasks" not in preview_only_app.conf["imports"]
    assert "tasks.knowledge_fs_lifecycle_tasks" not in preview_only_app.conf["imports"]
