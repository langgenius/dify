from types import SimpleNamespace
from unittest.mock import patch

import pytest

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.execution_coordinator import AppExecutionState
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueErrorEvent
from models import Tenant


class DummyQueueManager(AppQueueManager):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.published = []

    def _publish(self, event, pub_from):
        self.published.append((event, pub_from))


class TestBaseAppQueueManager:
    def test_init_requires_user_id(self):
        with pytest.raises(ValueError):
            DummyQueueManager(task_id="t1", user_id="", invoke_from=InvokeFrom.SERVICE_API)

    def test_publish_error_records_event(self):
        with patch("core.app.apps.base_app_queue_manager.redis_client") as mock_redis:
            mock_redis.setex.return_value = True
            manager = DummyQueueManager(task_id="t1", user_id="u1", invoke_from=InvokeFrom.SERVICE_API)
            manager.publish_error(ValueError("boom"), PublishFrom.TASK_PIPELINE)

        assert isinstance(manager.published[0][0], QueueErrorEvent)

    def test_set_stop_flag_checks_user(self):
        with patch("core.app.apps.base_app_queue_manager.redis_client") as mock_redis:
            mock_redis.get.return_value = b"end-user-u1"
            AppQueueManager.set_stop_flag(task_id="t1", invoke_from=InvokeFrom.SERVICE_API, user_id="u1")

        mock_redis.setex.assert_called_once()

    def test_set_stop_flag_no_user_check(self):
        with patch("core.app.apps.execution_coordinator.redis_client") as mock_redis:
            AppQueueManager.set_stop_flag_no_user_check(task_id="t1")

        mock_redis.setex.assert_called_once()

    def test_is_stopped_reads_cache(self):
        with patch("core.app.apps.base_app_queue_manager.redis_client") as mock_redis:
            mock_redis.setex.return_value = True
            mock_redis.get.return_value = b"1"
            manager = DummyQueueManager(task_id="t1", user_id="u1", invoke_from=InvokeFrom.SERVICE_API)

            assert manager._is_stopped() is True

    def test_check_for_sqlalchemy_models_raises(self):
        with patch("core.app.apps.base_app_queue_manager.redis_client") as mock_redis:
            mock_redis.setex.return_value = True
            manager = DummyQueueManager(task_id="t1", user_id="u1", invoke_from=InvokeFrom.SERVICE_API)

        bad = Tenant(name="Queued ORM model")
        with pytest.raises(TypeError):
            manager._check_for_sqlalchemy_models(bad)

    def test_completed_listener_defers_graph_runtime_state_cleanup_until_listener_exits(self):
        with (
            patch("core.app.apps.base_app_queue_manager.redis_client") as mock_redis,
            patch("core.app.apps.execution_coordinator.GraphEngineManager") as graph_engine_manager,
        ):
            mock_redis.setex.return_value = True
            mock_redis.get.return_value = None
            manager = DummyQueueManager(task_id="t1", user_id="u1", invoke_from=InvokeFrom.SERVICE_API)
            runtime_state = SimpleNamespace(name="runtime-state")
            manager.graph_runtime_state = runtime_state

            manager.stop_listen(execution_state=AppExecutionState.TERMINAL)

            assert manager.graph_runtime_state is runtime_state
            assert list(manager.listen()) == []
            assert manager.graph_runtime_state is None
            graph_engine_manager.return_value.send_stop_command.assert_not_called()

    def test_execution_coordinator_abort_is_idempotent_when_graph_stop_command_fails(self, caplog):
        with (
            patch("core.app.apps.base_app_queue_manager.redis_client") as queue_redis,
            patch("core.app.apps.execution_coordinator.redis_client") as execution_redis,
            patch("core.app.apps.execution_coordinator.GraphEngineManager") as graph_engine_manager,
        ):
            queue_redis.setex.return_value = True
            execution_redis.setex.return_value = True
            graph_engine_manager.return_value.send_stop_command.side_effect = RuntimeError("redis unavailable")
            manager = DummyQueueManager(task_id="t1", user_id="u1", invoke_from=InvokeFrom.SERVICE_API)

            assert manager._execution_coordinator.request_abort("stream closed") is True
            assert manager._execution_coordinator.request_abort("duplicate") is False

        execution_redis.setex.assert_called_once_with("generate_task_stopped:t1", 600, 1)
        graph_engine_manager.return_value.send_stop_command.assert_called_once_with("t1", reason="stream closed")
        assert "Failed to send stop command for app execution task=t1" in caplog.text
