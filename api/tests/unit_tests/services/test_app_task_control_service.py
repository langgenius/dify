"""Injected workflow cancellation preserves both transport mechanisms."""

from unittest.mock import MagicMock, patch

import pytest

from extensions.ext_redis import RedisClientWrapper
from services.app_task_service import AppTaskControlService


@pytest.mark.parametrize("command_fails", [False, True])
@pytest.mark.parametrize("task_id", ["task-1", ""])
def test_workflow_stop_sets_flag_before_sending_command(command_fails: bool, task_id: str) -> None:
    redis = MagicMock(spec=RedisClientWrapper)
    events: list[str] = []
    redis.setex.side_effect = lambda *_: events.append("flag")
    failure = RuntimeError("command channel unavailable")

    def send_stop(requested_task_id: str) -> None:
        assert requested_task_id == task_id
        events.append("command")
        if command_fails:
            raise failure

    with patch("services.app_task_service.GraphEngineManager") as manager:
        manager.return_value.send_stop_command.side_effect = send_stop
        service = AppTaskControlService(redis_client=redis)
        if command_fails:
            with pytest.raises(RuntimeError) as caught:
                service.stop_workflow_task_no_user_check(task_id=task_id)
            assert caught.value is failure
        else:
            service.stop_workflow_task_no_user_check(task_id=task_id)
        manager.assert_called_once_with(redis)

    if task_id:
        assert events == ["flag", "command"]
        redis.setex.assert_called_once_with("generate_task_stopped:task-1", 600, 1)
    else:
        assert events == ["command"]
        redis.setex.assert_not_called()
    redis.get.assert_not_called()


def test_flag_failure_does_not_send_command() -> None:
    redis = MagicMock(spec=RedisClientWrapper)
    redis.setex.side_effect = RuntimeError("flag store unavailable")
    with patch("services.app_task_service.GraphEngineManager") as manager:
        with pytest.raises(RuntimeError, match="flag store unavailable"):
            AppTaskControlService(redis_client=redis).stop_workflow_task_no_user_check(task_id="task-1")
    manager.assert_not_called()
