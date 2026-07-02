from __future__ import annotations

from types import SimpleNamespace

import pytest

from core.app.apps.workflow.command_channels import (
    CelerySignalCommandChannel,
    CombinedCommandChannel,
    reset_abort_command,
    set_abort_command,
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
def reset_signal_abort_command() -> None:
    reset_abort_command()
    yield
    reset_abort_command()


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


def test_celery_signal_command_channel_reads_abort_command() -> None:
    abort = AbortCommand(reason="worker shutdown")
    set_abort_command(abort)
    channel = CelerySignalCommandChannel()

    assert channel.fetch_commands() == [abort]


def test_celery_signal_command_channel_send_command_is_noop() -> None:
    channel = CelerySignalCommandChannel()
    command = PauseCommand(reason="pause")

    channel.send_command(command)

    assert channel.fetch_commands() == []
