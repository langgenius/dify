"""Injected workflow cancellation preserves both transport mechanisms."""

from unittest.mock import MagicMock

import pytest

from extensions.ext_redis import RedisClientWrapper
from graphon.engine.command import AbortCommand
from services.app_task_service import AppTaskControlService


@pytest.mark.parametrize("command_fails", [False, True])
@pytest.mark.parametrize("task_id", ["task-1", ""])
def test_workflow_stop_sets_flag_before_sending_command(command_fails: bool, task_id: str) -> None:
    redis = MagicMock(spec=RedisClientWrapper)
    events: list[str] = []
    redis.setex.side_effect = lambda *_: events.append("flag")
    pipeline = redis.pipeline.return_value

    def open_pipeline() -> MagicMock:
        events.append("command")
        if command_fails:
            raise RuntimeError("command channel unavailable")
        return pipeline

    redis.pipeline.side_effect = open_pipeline
    AppTaskControlService(redis_client=redis).stop_workflow_task_no_user_check(task_id=task_id)

    if task_id:
        assert events == ["flag", "command"]
        redis.setex.assert_called_once_with("generate_task_stopped:task-1", 600, 1)
        if not command_fails:
            queued = pipeline.__enter__.return_value.rpush
            queued.assert_called_once()
            key, payload = queued.call_args.args
            assert key == "workflow:task-1:commands"
            assert AbortCommand.model_validate_json(payload) == AbortCommand(reason="User requested stop")
    else:
        assert events == []
        redis.setex.assert_not_called()
        redis.pipeline.assert_not_called()
    redis.get.assert_not_called()


def test_flag_failure_does_not_send_command() -> None:
    redis = MagicMock(spec=RedisClientWrapper)
    redis.setex.side_effect = RuntimeError("flag store unavailable")
    with pytest.raises(RuntimeError, match="flag store unavailable"):
        AppTaskControlService(redis_client=redis).stop_workflow_task_no_user_check(task_id="task-1")
    redis.pipeline.assert_not_called()
