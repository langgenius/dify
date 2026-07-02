from __future__ import annotations

from types import SimpleNamespace

import pytest

from core.app.apps.workflow.command_channels import (
    WORKFLOW_WARM_SHUTDOWN_ABORT_REASON,
    CelerySignalCommandChannel,
    CombinedCommandChannel,
    reset_celery_signal_command_channels,
    send_celery_warm_shutdown_abort_commands,
)
from graphon.graph_engine.entities.commands import AbortCommand, PauseCommand


class _CommandChannelStub:
    def __init__(self, commands=None) -> None:
        self.commands = list(commands or [])
        self.sent = []

    def fetch_commands(self):
        commands = self.commands
        self.commands = []
        return commands

    def send_command(self, command) -> None:
        self.sent.append(command)


@pytest.fixture(autouse=True)
def reset_celery_signal_channels():
    reset_celery_signal_command_channels()
    yield
    reset_celery_signal_command_channels()


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
    assert "Failed to fetch GraphEngine commands" in caplog.text


def test_celery_signal_command_channel_receives_pushed_abort() -> None:
    channel = CelerySignalCommandChannel(task_id="task-a")

    with channel:
        channel_count = send_celery_warm_shutdown_abort_commands()
        commands = channel.fetch_commands()

    assert len(commands) == 1
    assert channel_count == 1
    assert isinstance(commands[0], AbortCommand)
    assert commands[0].reason == WORKFLOW_WARM_SHUTDOWN_ABORT_REASON
    assert channel.fetch_commands() == commands


def test_celery_signal_command_channel_registered_after_shutdown_receives_abort() -> None:
    assert send_celery_warm_shutdown_abort_commands(reason="worker shutdown") == 0
    channel = CelerySignalCommandChannel(task_id="task-a")

    with channel:
        commands = channel.fetch_commands()

    assert len(commands) == 1
    assert isinstance(commands[0], AbortCommand)
    assert commands[0].reason == "worker shutdown"


def test_celery_signal_command_channel_unregisters_on_exit() -> None:
    channel = CelerySignalCommandChannel(task_id="task-a")

    with channel:
        assert send_celery_warm_shutdown_abort_commands() == 1

    assert send_celery_warm_shutdown_abort_commands() == 0


def test_celery_signal_command_channel_send_command_is_noop() -> None:
    channel = CelerySignalCommandChannel(task_id="task-a")
    command = PauseCommand(reason="pause")

    channel.send_command(command)

    assert channel.fetch_commands() == []


def test_celery_signal_command_channel_rejects_duplicate_task_id() -> None:
    old_channel = CelerySignalCommandChannel(task_id="task-a")
    new_channel = CelerySignalCommandChannel(task_id="task-a")

    with old_channel:
        with pytest.raises(ValueError, match="already registered"):
            with new_channel:
                pass

        assert send_celery_warm_shutdown_abort_commands() == 1
        assert len(old_channel.fetch_commands()) == 1
