from __future__ import annotations

from types import SimpleNamespace

import pytest

from core.app.apps.workflow.active_workflow_tasks import active_workflow_task, reset_active_workflow_tasks
from core.app.apps.workflow.command_channels import (
    WORKFLOW_WARM_SHUTDOWN_ABORT_REASON,
    CelerySignalCommandChannel,
    CombinedCommandChannel,
    reset_celery_warm_shutdown_state,
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
    reset_active_workflow_tasks()
    reset_celery_warm_shutdown_state()
    yield
    reset_active_workflow_tasks()
    reset_celery_warm_shutdown_state()


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


def test_celery_signal_command_channel_reads_warm_shutdown_abort_command() -> None:
    channel = CelerySignalCommandChannel()

    with active_workflow_task("task-a"):
        run_count = send_celery_warm_shutdown_abort_commands()
        commands = channel.fetch_commands()

    assert len(commands) == 1
    assert run_count == 1
    assert isinstance(commands[0], AbortCommand)
    assert commands[0].reason == WORKFLOW_WARM_SHUTDOWN_ABORT_REASON
    assert channel.fetch_commands() == commands


def test_celery_signal_command_channel_registered_after_shutdown_receives_abort() -> None:
    assert send_celery_warm_shutdown_abort_commands(reason="worker shutdown") == 0
    channel = CelerySignalCommandChannel()

    with active_workflow_task("task-a"):
        commands = channel.fetch_commands()

    assert len(commands) == 1
    assert isinstance(commands[0], AbortCommand)
    assert commands[0].reason == "worker shutdown"


def test_celery_signal_command_channel_unregisters_on_exit() -> None:
    with active_workflow_task("task-a"):
        assert send_celery_warm_shutdown_abort_commands() == 1

    assert send_celery_warm_shutdown_abort_commands() == 0


def test_celery_signal_command_channel_send_command_is_noop() -> None:
    channel = CelerySignalCommandChannel()
    command = PauseCommand(reason="pause")

    channel.send_command(command)

    assert channel.fetch_commands() == []


def test_active_workflow_task_rejects_duplicate_task_id() -> None:
    with active_workflow_task("task-a"):
        with pytest.raises(ValueError, match="already active"):
            with active_workflow_task("task-a"):
                pass

        assert send_celery_warm_shutdown_abort_commands() == 1
