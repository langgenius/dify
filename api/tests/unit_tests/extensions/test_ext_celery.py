import ssl
from collections.abc import Iterator
from datetime import timedelta
from importlib import import_module
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import pytest
from celery.contrib.testing.app import TestApp, setup_default_app

from dify_app import DifyApp
from enums import DeploymentEdition
from extensions.ext_celery import (
    _enqueue_initial_community_telemetry_heartbeat,
    get_celery_broker_transport_options,
    init_app,
)
from services.knowledge_fs.background_contract import OPERATION_QUEUES, OPERATION_TASK
from services.knowledge_fs.lifecycle_readiness import KnowledgeFSLifecycleWorkerReadiness
from tests.helpers.unit.config_override import apply_config_overrides

"""Tests for Celery SSL configuration."""


class TestCelerySslCases:
    @staticmethod
    @pytest.fixture(autouse=True)
    def restore_celery_app_state() -> Iterator[None]:
        # init_app replaces Celery's process-wide current/default app. Restore both
        # so later shared tasks do not enter this module's Flask app context.
        with setup_default_app(TestApp()):
            yield

    class TestCelerySSLConfiguration:
        """Test suite for Celery SSL configuration."""

        def test_get_celery_broker_transport_options_includes_global_keyprefix_for_redis(self):
            mock_config = MagicMock()
            mock_config.CELERY_USE_SENTINEL = False
            mock_config.REDIS_KEY_PREFIX = "enterprise-a"

            with patch("extensions.ext_celery.dify_config", mock_config):
                from extensions.ext_celery import get_celery_broker_transport_options

                result = get_celery_broker_transport_options()

            assert result["global_keyprefix"] == "enterprise-a:"

        def test_get_celery_broker_transport_options_omits_global_keyprefix_when_prefix_empty(self):
            mock_config = MagicMock()
            mock_config.CELERY_USE_SENTINEL = False
            mock_config.REDIS_KEY_PREFIX = "   "

            with patch("extensions.ext_celery.dify_config", mock_config):
                from extensions.ext_celery import get_celery_broker_transport_options

                result = get_celery_broker_transport_options()

            assert "global_keyprefix" not in result

        def test_get_celery_broker_transport_options_keeps_sentinel_and_adds_global_keyprefix(self):
            mock_config = MagicMock()
            mock_config.CELERY_USE_SENTINEL = True
            mock_config.CELERY_SENTINEL_MASTER_NAME = "mymaster"
            mock_config.CELERY_SENTINEL_SOCKET_TIMEOUT = 0.1
            mock_config.CELERY_SENTINEL_PASSWORD = "secret"
            mock_config.REDIS_KEY_PREFIX = "enterprise-a"

            with patch("extensions.ext_celery.dify_config", mock_config):
                from extensions.ext_celery import get_celery_broker_transport_options

                result = get_celery_broker_transport_options()

            assert result["master_name"] == "mymaster"
            assert result["sentinel_kwargs"]["password"] == "secret"
            assert result["global_keyprefix"] == "enterprise-a:"

        def test_get_celery_ssl_options_when_ssl_disabled(self):
            """Test SSL options when BROKER_USE_SSL is False."""
            from configs import DifyConfig

            dify_config = DifyConfig(CELERY_BROKER_URL="redis://localhost:6379/0")

            with patch("extensions.ext_celery.dify_config", dify_config):
                from extensions.ext_celery import get_celery_ssl_options

                result = get_celery_ssl_options()
                assert result is None

        def test_get_celery_ssl_options_when_broker_not_redis(self):
            """Test SSL options when broker is not Redis."""
            mock_config = MagicMock()
            mock_config.CELERY_BROKER_URL = "amqp://localhost:5672"

            with patch("extensions.ext_celery.dify_config", mock_config):
                from extensions.ext_celery import get_celery_ssl_options

                result = get_celery_ssl_options()
                assert result is None

        def test_get_celery_ssl_options_with_cert_none(self):
            """Test SSL options with CERT_NONE requirement."""
            mock_config = MagicMock()
            mock_config.CELERY_BROKER_URL = "redis://localhost:6379/0"
            mock_config.REDIS_SSL_CERT_REQS = "CERT_NONE"
            mock_config.REDIS_SSL_CA_CERTS = None
            mock_config.REDIS_SSL_CERTFILE = None
            mock_config.REDIS_SSL_KEYFILE = None

            with patch("extensions.ext_celery.dify_config", mock_config):
                from extensions.ext_celery import get_celery_ssl_options

                result = get_celery_ssl_options()
                assert result is not None
                assert result["ssl_cert_reqs"] == ssl.CERT_NONE
                assert result["ssl_ca_certs"] is None
                assert result["ssl_certfile"] is None
                assert result["ssl_keyfile"] is None

        def test_get_celery_ssl_options_with_cert_required(self):
            """Test SSL options with CERT_REQUIRED and certificates."""
            mock_config = MagicMock()
            mock_config.CELERY_BROKER_URL = "rediss://localhost:6380/0"
            mock_config.REDIS_SSL_CERT_REQS = "CERT_REQUIRED"
            mock_config.REDIS_SSL_CA_CERTS = "/path/to/ca.crt"
            mock_config.REDIS_SSL_CERTFILE = "/path/to/client.crt"
            mock_config.REDIS_SSL_KEYFILE = "/path/to/client.key"

            with patch("extensions.ext_celery.dify_config", mock_config):
                from extensions.ext_celery import get_celery_ssl_options

                result = get_celery_ssl_options()
                assert result is not None
                assert result["ssl_cert_reqs"] == ssl.CERT_REQUIRED
                assert result["ssl_ca_certs"] == "/path/to/ca.crt"
                assert result["ssl_certfile"] == "/path/to/client.crt"
                assert result["ssl_keyfile"] == "/path/to/client.key"

        def test_get_celery_ssl_options_with_cert_optional(self):
            """Test SSL options with CERT_OPTIONAL requirement."""
            mock_config = MagicMock()
            mock_config.CELERY_BROKER_URL = "redis://localhost:6379/0"
            mock_config.REDIS_SSL_CERT_REQS = "CERT_OPTIONAL"
            mock_config.REDIS_SSL_CA_CERTS = "/path/to/ca.crt"
            mock_config.REDIS_SSL_CERTFILE = None
            mock_config.REDIS_SSL_KEYFILE = None

            with patch("extensions.ext_celery.dify_config", mock_config):
                from extensions.ext_celery import get_celery_ssl_options

                result = get_celery_ssl_options()
                assert result is not None
                assert result["ssl_cert_reqs"] == ssl.CERT_OPTIONAL
                assert result["ssl_ca_certs"] == "/path/to/ca.crt"

        def test_get_celery_ssl_options_with_invalid_cert_reqs(self):
            """Test SSL options with invalid cert requirement defaults to CERT_NONE."""
            mock_config = MagicMock()
            mock_config.CELERY_BROKER_URL = "redis://localhost:6379/0"
            mock_config.REDIS_SSL_CERT_REQS = "INVALID_VALUE"
            mock_config.REDIS_SSL_CA_CERTS = None
            mock_config.REDIS_SSL_CERTFILE = None
            mock_config.REDIS_SSL_KEYFILE = None

            with patch("extensions.ext_celery.dify_config", mock_config):
                from extensions.ext_celery import get_celery_ssl_options

                result = get_celery_ssl_options()
                assert result is not None
                assert result["ssl_cert_reqs"] == ssl.CERT_NONE  # Should default to CERT_NONE

        def test_celery_init_applies_ssl_to_broker_and_backend(self):
            """Test that SSL options are applied to both broker and backend when using Redis."""
            mock_config = MagicMock()
            mock_config.HUMAN_INPUT_TIMEOUT_TASK_INTERVAL = 1
            mock_config.CELERY_BROKER_URL = "redis://localhost:6379/0"
            mock_config.CELERY_BACKEND = "redis"
            mock_config.CELERY_RESULT_BACKEND = "redis://localhost:6379/0"
            mock_config.REDIS_SSL_CERT_REQS = "CERT_NONE"
            mock_config.REDIS_SSL_CA_CERTS = None
            mock_config.REDIS_SSL_CERTFILE = None
            mock_config.REDIS_SSL_KEYFILE = None
            mock_config.CELERY_USE_SENTINEL = False
            mock_config.LOG_FORMAT = "%(message)s"
            mock_config.LOG_TZ = "UTC"
            mock_config.LOG_FILE = None

            # Mock all the scheduler configs
            mock_config.CELERY_BEAT_SCHEDULER_TIME = 1
            mock_config.AGENT_SANDBOX_METERING_ENABLED = False
            mock_config.ENABLE_CONVERSATION_CLEANUP_TASK = False
            mock_config.CONVERSATION_CLEANUP_TASK_INTERVAL = 5
            mock_config.ENABLE_CLEAN_EMBEDDING_CACHE_TASK = False
            mock_config.ENABLE_CLEAN_UNUSED_DATASETS_TASK = False
            mock_config.ENABLE_CREATE_TIDB_SERVERLESS_TASK = False
            mock_config.ENABLE_UPDATE_TIDB_SERVERLESS_STATUS_TASK = False
            mock_config.ENABLE_CLEAN_MESSAGES = False
            mock_config.ENABLE_MAIL_CLEAN_DOCUMENT_NOTIFY_TASK = False
            mock_config.ENABLE_DATASETS_QUEUE_MONITOR = False
            mock_config.ENABLE_CHECK_UPGRADABLE_PLUGIN_TASK = False
            mock_config.ENABLE_WORKFLOW_SCHEDULE_POLLER_TASK = False
            mock_config.WORKFLOW_SCHEDULE_POLLER_INTERVAL = 1
            mock_config.WORKFLOW_SCHEDULE_POLLER_BATCH_SIZE = 100
            mock_config.WORKFLOW_SCHEDULE_MAX_DISPATCH_PER_TICK = 0
            mock_config.ENABLE_TRIGGER_PROVIDER_REFRESH_TASK = False
            mock_config.TRIGGER_PROVIDER_REFRESH_INTERVAL = 15
            mock_config.ENABLE_API_TOKEN_LAST_USED_UPDATE_TASK = False
            mock_config.API_TOKEN_LAST_USED_UPDATE_INTERVAL = 30

            with (
                patch("extensions.ext_celery.dify_config", mock_config),
                patch(
                    "services.knowledge_fs.lifecycle_readiness.get_configured_knowledge_fs_lifecycle_worker_readiness",
                    return_value=KnowledgeFSLifecycleWorkerReadiness(ready=False, blockers=()),
                ),
            ):
                from dify_app import DifyApp
                from extensions.ext_celery import init_app

                app = DifyApp(__name__)
                celery_app = init_app(app)

                # Check that SSL options were applied
                assert "broker_use_ssl" in celery_app.conf
                assert celery_app.conf["broker_use_ssl"] is not None
                assert celery_app.conf["broker_use_ssl"]["ssl_cert_reqs"] == ssl.CERT_NONE

                # Check that SSL is also applied to Redis backend
                assert "redis_backend_use_ssl" in celery_app.conf
                assert celery_app.conf["redis_backend_use_ssl"] is not None

        def test_celery_init_registers_required_agent_and_conversation_tasks(self):
            mock_config = MagicMock()
            mock_config.BROKER_USE_SSL = False
            mock_config.REDIS_KEY_PREFIX = "enterprise-a"
            mock_config.HUMAN_INPUT_TIMEOUT_TASK_INTERVAL = 1
            mock_config.CELERY_BROKER_URL = "redis://localhost:6379/0"
            mock_config.CELERY_BACKEND = "redis"
            mock_config.CELERY_RESULT_BACKEND = "redis://localhost:6379/0"
            mock_config.CELERY_USE_SENTINEL = False
            mock_config.LOG_FORMAT = "%(message)s"
            mock_config.LOG_TZ = "UTC"
            mock_config.LOG_FILE = None
            mock_config.CELERY_TASK_ANNOTATIONS = {}

            mock_config.CELERY_BEAT_SCHEDULER_TIME = 1
            mock_config.AGENT_SANDBOX_METERING_ENABLED = False
            mock_config.ENABLE_CONVERSATION_CLEANUP_TASK = True
            mock_config.CONVERSATION_CLEANUP_TASK_INTERVAL = 5
            mock_config.ENABLE_CLEAN_EMBEDDING_CACHE_TASK = False
            mock_config.ENABLE_CLEAN_UNUSED_DATASETS_TASK = False
            mock_config.ENABLE_CREATE_TIDB_SERVERLESS_TASK = False
            mock_config.ENABLE_UPDATE_TIDB_SERVERLESS_STATUS_TASK = False
            mock_config.ENABLE_CLEAN_MESSAGES = False
            mock_config.ENABLE_MAIL_CLEAN_DOCUMENT_NOTIFY_TASK = False
            mock_config.ENABLE_DATASETS_QUEUE_MONITOR = False
            mock_config.ENABLE_HUMAN_INPUT_TIMEOUT_TASK = False
            mock_config.ENABLE_CHECK_UPGRADABLE_PLUGIN_TASK = False
            mock_config.MARKETPLACE_ENABLED = False
            mock_config.WORKFLOW_LOG_CLEANUP_ENABLED = False
            mock_config.ENABLE_WORKFLOW_RUN_CLEANUP_TASK = False
            mock_config.ENABLE_WORKFLOW_SCHEDULE_POLLER_TASK = False
            mock_config.WORKFLOW_SCHEDULE_POLLER_INTERVAL = 1
            mock_config.ENABLE_TRIGGER_PROVIDER_REFRESH_TASK = False
            mock_config.TRIGGER_PROVIDER_REFRESH_INTERVAL = 15
            mock_config.ENABLE_API_TOKEN_LAST_USED_UPDATE_TASK = False
            mock_config.API_TOKEN_LAST_USED_UPDATE_INTERVAL = 30
            mock_config.DEPLOYMENT_EDITION = DeploymentEdition.COMMUNITY
            mock_config.ENTERPRISE_TELEMETRY_ENABLED = False

            with (
                patch("extensions.ext_celery.dify_config", mock_config),
                patch(
                    "services.knowledge_fs.lifecycle_readiness.get_configured_knowledge_fs_lifecycle_worker_readiness",
                    return_value=KnowledgeFSLifecycleWorkerReadiness(ready=False, blockers=()),
                ),
            ):
                from dify_app import DifyApp
                from extensions.ext_celery import init_app

                app = DifyApp(__name__)
                celery_app = init_app(app)

            assert celery_app.conf["broker_transport_options"]["global_keyprefix"] == "enterprise-a:"
            assert celery_app.conf["result_backend_transport_options"]["global_keyprefix"] == "enterprise-a:"
            assert "tasks.collect_agent_resources_task" in celery_app.conf["imports"]
            assert "tasks.delete_conversation_task" in celery_app.conf["imports"]
            assert "tasks.workflow_run_archive_deletion_tasks" in celery_app.conf["imports"]
            import_module("tasks.workflow_run_archive_deletion_tasks")
            task_name = "tasks.workflow_run_archive_deletion_tasks.delete_workflow_run_archive_task"
            archive_deletion = celery_app.tasks[task_name]
            assert archive_deletion.queue == "workflow_archive"
            assert archive_deletion.acks_late is True
            assert archive_deletion.reject_on_worker_lost is True
            assert archive_deletion.autoretry_for == (Exception,)
            assert archive_deletion.retry_kwargs["max_retries"] == 5
            assert celery_app.conf["beat_schedule"]["conversation_cleanup_sweeper"]["task"] == (
                "tasks.delete_conversation_task.sweep_deleted_conversations"
            )


class TestCommunityTelemetryCeleryCases:
    @staticmethod
    def test_beat_start_enqueues_community_telemetry_heartbeat() -> None:
        task = Mock()
        sender = SimpleNamespace(
            app=SimpleNamespace(
                conf=SimpleNamespace(beat_schedule={"community_telemetry_heartbeat": {}}),
                tasks={"community_telemetry.send_heartbeat": task},
            )
        )

        _enqueue_initial_community_telemetry_heartbeat(sender)

        task.apply_async.assert_called_once_with()

    @staticmethod
    def test_beat_start_skips_community_telemetry_when_not_scheduled() -> None:
        task = Mock()
        sender = SimpleNamespace(
            app=SimpleNamespace(
                conf=SimpleNamespace(beat_schedule={}),
                tasks={"community_telemetry.send_heartbeat": task},
            )
        )

        _enqueue_initial_community_telemetry_heartbeat(sender)

        task.apply_async.assert_not_called()

    @staticmethod
    def test_beat_start_skips_community_telemetry_when_task_is_unavailable() -> None:
        sender = SimpleNamespace(
            app=SimpleNamespace(
                conf=SimpleNamespace(beat_schedule={"community_telemetry_heartbeat": {}}),
                tasks={},
            )
        )

        _enqueue_initial_community_telemetry_heartbeat(sender)


class TestKnowledgeFsCeleryCases:
    @staticmethod
    @pytest.fixture(autouse=True)
    def restore_celery_app_state() -> Iterator[None]:
        # init_app replaces Celery's process-wide current/default app; restore both so
        # later shared tasks still resolve against the app that registered them.
        with setup_default_app(TestApp()):
            yield

    @staticmethod
    @pytest.mark.parametrize("background_enabled", [False, True])
    @pytest.mark.parametrize("vector_store", ["qdrant", "tidb_on_qdrant", "elasticsearch", "weaviate"])
    def test_celery_registers_initial_source_task_when_knowledge_fs_lifecycle_is_ready(
        background_enabled: bool, vector_store: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A stale deployment variable must not suppress vector cleanup for the selected provider.
        monkeypatch.setenv("KNOWLEDGE_VECTOR_STORAGE", "postgres")
        apply_config_overrides(
            monkeypatch,
            REDIS_KEY_PREFIX="test",
            HUMAN_INPUT_TIMEOUT_TASK_INTERVAL=1,
            CELERY_BROKER_URL="redis://localhost:6379/0",
            CELERY_BACKEND="redis",
            CELERY_USE_SENTINEL=False,
            CELERY_BROKER_VISIBILITY_TIMEOUT=10800,
            KNOWLEDGE_FS_BACKGROUND_WORKER_ENABLED=background_enabled,
            VECTOR_STORE=vector_store,
            KNOWLEDGE_FS_BACKGROUND_POLL_INTERVAL_SECONDS=5,
            KNOWLEDGE_FS_BACKGROUND_TASK_TIMEOUT_SECONDS=7200,
            LOG_FORMAT="%(message)s",
            LOG_TZ="UTC",
            LOG_FILE=None,
            CELERY_TASK_ANNOTATIONS=dict[str, object](),
            CELERY_BEAT_SCHEDULER_TIME=1,
            KNOWLEDGE_FS_LIFECYCLE_POLL_INTERVAL_SECONDS=2,
            ENABLE_CONVERSATION_CLEANUP_TASK=True,
            CONVERSATION_CLEANUP_TASK_INTERVAL=5,
            ENABLE_CLEAN_EMBEDDING_CACHE_TASK=False,
            ENABLE_CLEAN_UNUSED_DATASETS_TASK=False,
            ENABLE_CREATE_TIDB_SERVERLESS_TASK=False,
            ENABLE_UPDATE_TIDB_SERVERLESS_STATUS_TASK=False,
            ENABLE_CLEAN_MESSAGES=False,
            ENABLE_MAIL_CLEAN_DOCUMENT_NOTIFY_TASK=False,
            ENABLE_DATASETS_QUEUE_MONITOR=False,
            ENABLE_HUMAN_INPUT_TIMEOUT_TASK=False,
            ENABLE_CHECK_UPGRADABLE_PLUGIN_TASK=False,
            MARKETPLACE_ENABLED=False,
            WORKFLOW_LOG_CLEANUP_ENABLED=False,
            ENABLE_WORKFLOW_RUN_CLEANUP_TASK=False,
            ENABLE_WORKFLOW_SCHEDULE_POLLER_TASK=False,
            WORKFLOW_SCHEDULE_POLLER_INTERVAL=1,
            ENABLE_TRIGGER_PROVIDER_REFRESH_TASK=False,
            TRIGGER_PROVIDER_REFRESH_INTERVAL=15,
            ENABLE_API_TOKEN_LAST_USED_UPDATE_TASK=False,
            API_TOKEN_LAST_USED_UPDATE_INTERVAL=30,
            ENTERPRISE_TELEMETRY_ENABLED=False,
        )

        with (
            patch(
                "services.knowledge_fs.lifecycle_readiness.get_configured_knowledge_fs_lifecycle_worker_readiness",
                return_value=KnowledgeFSLifecycleWorkerReadiness(ready=True, blockers=()),
            ),
        ):
            celery_app = init_app(DifyApp(__name__))

        assert "tasks.knowledge_fs_initial_source_tasks" in celery_app.conf["imports"]
        assert "tasks.knowledge_fs_initial_source_preview_tasks" in celery_app.conf["imports"]
        assert "tasks.knowledge_fs_failed_retrieval_tasks" in celery_app.conf["imports"]
        assert "tasks.knowledge_fs_lifecycle_tasks" in celery_app.conf["imports"]
        assert "tasks.knowledge_fs_source_import_tasks" in celery_app.conf["imports"]
        assert "tasks.delete_conversation_task" in celery_app.conf["imports"]
        assert celery_app.conf["beat_schedule"]["conversation_cleanup_sweeper"] == {
            "task": "tasks.delete_conversation_task.sweep_deleted_conversations",
            "schedule": timedelta(minutes=5),
        }
        assert celery_app.conf["beat_schedule"]["knowledge_fs_staged_upload_cleanup"] == {
            "task": "tasks.knowledge_fs_lifecycle_tasks.cleanup_knowledge_fs_staged_uploads",
            "schedule": timedelta(seconds=2),
        }
        assert celery_app.conf["beat_schedule"]["knowledge_fs_upgrade_file_cleanup"] == {
            "task": "tasks.knowledge_fs_upgrade_tasks.cleanup_deferred_knowledge_fs_upgrade_files",
            "schedule": timedelta(seconds=2),
        }
        assert celery_app.conf["beat_schedule"]["knowledge_fs_upgrade_recovery"] == {
            "task": "tasks.knowledge_fs_upgrade_tasks.recover_stalled_knowledge_fs_upgrades",
            "schedule": timedelta(seconds=60),
            "options": {"expires": 60},
        }
        schedules = celery_app.conf["beat_schedule"]
        if background_enabled:
            assert celery_app.conf["broker_transport_options"]["visibility_timeout"] == 10800
            for operation, queue in OPERATION_QUEUES.items():
                assert schedules[f"knowledge_fs_background_{operation}"] == {
                    "task": OPERATION_TASK,
                    "schedule": timedelta(seconds=5),
                    "kwargs": {"operation": operation},
                    "options": {"queue": queue, "expires": 30},
                }
        else:
            assert not any(name.startswith("knowledge_fs_background_") for name in schedules)

        with (
            patch(
                "services.knowledge_fs.lifecycle_readiness.get_configured_knowledge_fs_lifecycle_worker_readiness",
                return_value=KnowledgeFSLifecycleWorkerReadiness(ready=False, blockers=("test",)),
            ),
        ):
            preview_only_app = init_app(DifyApp(f"{__name__}.preview_only"))

        assert "tasks.knowledge_fs_initial_source_preview_tasks" in preview_only_app.conf["imports"]
        assert "tasks.knowledge_fs_failed_retrieval_tasks" in preview_only_app.conf["imports"]
        assert "tasks.knowledge_fs_initial_source_tasks" not in preview_only_app.conf["imports"]
        assert "tasks.knowledge_fs_lifecycle_tasks" not in preview_only_app.conf["imports"]
        assert "tasks.knowledge_fs_source_import_tasks" not in preview_only_app.conf["imports"]
        assert "knowledge_fs_upgrade_recovery" not in preview_only_app.conf["beat_schedule"]

    @staticmethod
    @pytest.mark.parametrize("visibility", [None, 3600, 7200, 7230])
    def test_long_running_delivery_rejects_an_unsafe_redis_visibility(visibility: int | None) -> None:
        with patch("extensions.ext_celery.dify_config") as config:
            config.CELERY_USE_SENTINEL = False
            config.REDIS_KEY_PREFIX = ""
            config.CELERY_BROKER_URL = "redis://localhost:6379/0"
            config.CELERY_BROKER_VISIBILITY_TIMEOUT = visibility
            config.KNOWLEDGE_FS_BACKGROUND_WORKER_ENABLED = True
            config.KNOWLEDGE_FS_BACKGROUND_TASK_TIMEOUT_SECONDS = 7200
            with pytest.raises(ValueError, match="VISIBILITY_TIMEOUT"):
                get_celery_broker_transport_options()
