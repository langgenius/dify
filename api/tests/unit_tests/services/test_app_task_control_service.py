"""Injected workflow cancellation preserves both transport mechanisms."""

from unittest.mock import MagicMock, patch

import pytest
from redis.client import Pipeline

from extensions.ext_redis import RedisClientWrapper
from graphon.engine.command import AbortCommand
from services.app_task_service import AppTaskControlService


@pytest.mark.parametrize("command_fails", [False, True])
@pytest.mark.parametrize("task_id", ["task-1", ""])
def test_workflow_stop_sets_flag_before_sending_command(
    redis_transport: tuple[RedisClientWrapper, MagicMock], command_fails: bool, task_id: str
) -> None:
    redis, commands = redis_transport
    events: list[str] = []
    queued: list[tuple[object, ...]] = []
    commands.side_effect = lambda *_, **__: events.append("flag")

    def execute_pipeline(pipeline: "Pipeline[bytes]") -> list[object]:
        events.append("command")
        queued.extend(args for args, _ in pipeline.command_stack)
        if command_fails:
            raise RuntimeError("command channel unavailable")
        return []

    with patch.object(Pipeline, "execute", autospec=True, side_effect=execute_pipeline):
        AppTaskControlService(redis_client=redis).stop_workflow_task_no_user_check(task_id=task_id)

    if task_id:
        assert events == ["flag", "command"]
        commands.assert_called_once_with("SETEX", "generate_task_stopped:task-1", 600, 1)
        pushes = [args for args in queued if args[0] == "RPUSH"]
        assert len(pushes) == 1
        _, key, payload = pushes[0]
        assert key == "workflow:task-1:commands"
        assert isinstance(payload, str)
        assert AbortCommand.model_validate_json(payload) == AbortCommand(reason="User requested stop")
    else:
        assert events == []
        assert queued == []
        commands.assert_not_called()


def test_flag_failure_does_not_send_command(redis_transport: tuple[RedisClientWrapper, MagicMock]) -> None:
    redis, commands = redis_transport
    commands.side_effect = RuntimeError("flag store unavailable")
    with patch.object(Pipeline, "execute", autospec=True) as execute:
        with pytest.raises(RuntimeError, match="flag store unavailable"):
            AppTaskControlService(redis_client=redis).stop_workflow_task_no_user_check(task_id="task-1")
    execute.assert_not_called()
