import errno
import logging
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueErrorEvent


class DummyQueueManager(AppQueueManager):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.published = []

    def _publish(self, event, pub_from):
        self.published.append((event, pub_from))


def _redis_broken_pipe_error() -> RedisConnectionError:
    error = RedisConnectionError("Error 32 while writing to socket. Broken pipe.")
    error.__context__ = BrokenPipeError(errno.EPIPE, "Broken pipe")
    return error


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
        with patch("core.app.apps.base_app_queue_manager.redis_client") as mock_redis:
            AppQueueManager.set_stop_flag_no_user_check(task_id="t1")

        mock_redis.setex.assert_called_once()

    def test_is_stopped_reads_cache(self):
        with patch("core.app.apps.base_app_queue_manager.redis_client") as mock_redis:
            mock_redis.setex.return_value = True
            mock_redis.get.return_value = b"1"
            manager = DummyQueueManager(task_id="t1", user_id="u1", invoke_from=InvokeFrom.SERVICE_API)

            assert manager._is_stopped() is True

    @pytest.mark.parametrize(
        "error",
        [
            pytest.param(BrokenPipeError(errno.EPIPE, "Broken pipe"), id="direct"),
            pytest.param(_redis_broken_pipe_error(), id="redis-connection-error"),
        ],
    )
    def test_is_stopped_ignores_broken_pipe(self, error: BaseException, caplog: pytest.LogCaptureFixture):
        with patch("core.app.apps.base_app_queue_manager.redis_client") as mock_redis:
            mock_redis.setex.return_value = True
            mock_redis.get.side_effect = error
            manager = DummyQueueManager(task_id="t1", user_id="u1", invoke_from=InvokeFrom.SERVICE_API)

            with caplog.at_level(logging.WARNING, logger="core.app.apps.base_app_queue_manager"):
                assert manager._is_stopped() is False

        assert "Ignoring broken pipe while checking task stop flag" in caplog.text
        assert "task=t1" in caplog.text
        assert "key=generate_task_stopped:t1" in caplog.text

    def test_is_stopped_propagates_other_redis_connection_errors(self):
        with patch("core.app.apps.base_app_queue_manager.redis_client") as mock_redis:
            mock_redis.setex.return_value = True
            mock_redis.get.side_effect = RedisConnectionError("Connection refused")
            manager = DummyQueueManager(task_id="t1", user_id="u1", invoke_from=InvokeFrom.SERVICE_API)

            with pytest.raises(RedisConnectionError, match="Connection refused"):
                manager._is_stopped()

    def test_check_for_sqlalchemy_models_raises(self):
        with patch("core.app.apps.base_app_queue_manager.redis_client") as mock_redis:
            mock_redis.setex.return_value = True
            manager = DummyQueueManager(task_id="t1", user_id="u1", invoke_from=InvokeFrom.SERVICE_API)

        bad = SimpleNamespace(_sa_instance_state=True)
        with pytest.raises(TypeError):
            manager._check_for_sqlalchemy_models(bad)
