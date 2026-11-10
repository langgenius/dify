from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from core.app.apps.execution_coordinator import AppExecutionCoordinator, send_abort_command
from core.app.apps.workflow.command_channels import (
    CelerySignalCommandChannel,
    CombinedCommandChannel,
    StopFlagCommandChannel,
)
from graphon.engine.command import AbortCommand, Command, PauseCommand, RedisChannel
from graphon.engine.command.processor import CommandProcessor
from graphon.engine.frame import FrameRegistry
from graphon.runtime.execution import GraphExecution


class _CommandChannelStub:
    def __init__(self, commands: list[Command] | None = None) -> None:
        self.commands = list(commands or [])
        self.sent: list[Command] = []

    def fetch_commands(self) -> list[Command]:
        commands = self.commands
        self.commands = []
        return commands

    def send_command(self, command: Command) -> None:
        self.sent.append(command)


def test_send_abort_command_uses_workflow_redis_channel() -> None:
    with patch.object(RedisChannel, "send_command", autospec=True) as send:
        send_abort_command("task-id", reason="stop")

    send.assert_called_once()
    channel, command = send.call_args.args
    assert channel._key == "workflow:task-id:commands"
    assert isinstance(command, AbortCommand)
    assert command.reason == "stop"


def test_send_abort_command_preserves_legacy_fallback(caplog: pytest.LogCaptureFixture) -> None:
    with patch.object(
        RedisChannel, "send_command", autospec=True, side_effect=RuntimeError("redis unavailable")
    ) as send:
        send_abort_command("task-id")
        send_abort_command("")

    send.assert_called_once()
    assert send.call_args.args[1].reason == "User requested stop"
    assert "Failed to send Engine abort command for task task-id" in caplog.text


def test_combined_command_channel_fetches_from_all_sources() -> None:
    abort = AbortCommand(reason="stop")
    pause = PauseCommand(reason="pause")
    combined = CombinedCommandChannel(
        (
            _CommandChannelStub([abort]),
            _CommandChannelStub([pause]),
        )
    )

    assert combined.fetch_commands() == [abort, pause]


def test_combined_command_channel_sends_to_primary_source() -> None:
    primary = _CommandChannelStub()
    secondary = _CommandChannelStub()
    combined = CombinedCommandChannel((primary, secondary))
    command = AbortCommand(reason="stop")

    combined.send_command(command)

    assert primary.sent == [command]
    assert secondary.sent == []


def test_combined_command_channel_requires_at_least_one_source() -> None:
    with pytest.raises(ValueError, match="command_channels must not be empty"):
        CombinedCommandChannel(())


def test_combined_command_channel_continues_after_source_failure(caplog: pytest.LogCaptureFixture) -> None:
    abort = AbortCommand(reason="stop")
    failing = SimpleNamespace(
        fetch_commands=lambda: (_ for _ in ()).throw(RuntimeError("boom")),
        send_command=lambda _command: None,
    )
    combined = CombinedCommandChannel((failing, _CommandChannelStub([abort])))

    assert combined.fetch_commands() == [abort]
    assert "Failed to fetch Engine commands" in caplog.text


def test_celery_signal_command_channel_emits_abort_when_shutdown_starts() -> None:
    shutdown_started = False
    channel = CelerySignalCommandChannel(
        shutdown_state_getter=lambda: shutdown_started,
        abort_reason="worker shutdown",
    )

    assert channel.fetch_commands() == []

    shutdown_started = True

    commands = channel.fetch_commands()

    assert len(commands) == 1
    assert isinstance(commands[0], AbortCommand)
    assert commands[0].reason == "worker shutdown"


def test_celery_signal_command_channel_emits_abort_once_per_instance() -> None:
    channel = CelerySignalCommandChannel(
        shutdown_state_getter=lambda: True,
        abort_reason="worker shutdown",
    )

    assert len(channel.fetch_commands()) == 1
    assert channel.fetch_commands() == []


def test_stop_flag_command_channel_emits_abort_when_flag_is_set() -> None:
    channel = StopFlagCommandChannel(task_id="task-1")

    with patch("core.app.apps.workflow.command_channels.get_app_task_stop_reason", return_value=None):
        assert channel.fetch_commands() == []

    with patch("core.app.apps.workflow.command_channels.get_app_task_stop_reason", return_value="User requested stop"):
        commands = channel.fetch_commands()

    assert len(commands) == 1
    assert isinstance(commands[0], AbortCommand)
    assert commands[0].reason == "User requested stop"


def test_stop_flag_command_channel_emits_abort_once_per_instance() -> None:
    channel = StopFlagCommandChannel(task_id="task-1")

    with patch("core.app.apps.workflow.command_channels.get_app_task_stop_reason", return_value="User requested stop"):
        assert len(channel.fetch_commands()) == 1
        assert channel.fetch_commands() == []


@pytest.mark.parametrize("poll_after_flag", [False, True], ids=["same-poll", "flag-first"])
@pytest.mark.parametrize("command_failure", [False, True], ids=["command-delivered", "command-unavailable"])
def test_timeout_reason_survives_both_cancellation_channels(poll_after_flag: bool, command_failure: bool) -> None:
    reason = "App execution exceeded 1800 seconds"
    primary = _CommandChannelStub()
    combined = CombinedCommandChannel((primary, StopFlagCommandChannel(task_id="task")))
    execution = GraphExecution(workflow_id="workflow")
    processor = CommandProcessor(combined, execution, FrameRegistry())
    observed_errors: list[str] = []
    stored_flags: list[tuple[str, int, str | int]] = []

    with (
        patch("core.app.apps.execution_coordinator.redis_client") as redis_client,
        patch.object(RedisChannel, "send_command") as send,
    ):
        redis_client.get.return_value = None
        send.side_effect = RuntimeError("command channel unavailable") if command_failure else primary.commands.append

        def store_flag(key: str, ttl: int, value: str | int) -> None:
            stored_flags.append((key, ttl, value))
            redis_client.get.return_value = str(value).encode()
            if poll_after_flag:
                processor.process_commands()
                observed_errors.append(str(execution.error))

        redis_client.setex.side_effect = store_flag
        coordinator = AppExecutionCoordinator(task_id="task", on_timeout=lambda _: None, timeout_seconds=1800)
        coordinator._handle_timeout()
        processor.process_commands()
        processor.process_commands()

    assert execution.aborted is True
    assert str(execution.error) == f"Aborted: {reason}"
    assert all(error == f"Aborted: {reason}" for error in observed_errors)
    assert stored_flags == [("generate_task_stopped:task", 600, reason)]
    send.assert_called_once_with(AbortCommand(reason=reason))


def test_stop_flag_preserves_reason_after_abort_command_was_processed() -> None:
    reason = "App execution exceeded 1800 seconds"
    primary = _CommandChannelStub([AbortCommand(reason=reason)])
    combined = CombinedCommandChannel((primary, StopFlagCommandChannel(task_id="task")))
    execution = GraphExecution(workflow_id="workflow")
    processor = CommandProcessor(combined, execution, FrameRegistry())

    with patch("core.app.apps.execution_coordinator.redis_client") as redis_client:
        redis_client.get.return_value = None
        processor.process_commands()
        assert str(execution.error) == f"Aborted: {reason}"

        redis_client.get.return_value = reason.encode()
        processor.process_commands()
        assert str(execution.error) == f"Aborted: {reason}"
