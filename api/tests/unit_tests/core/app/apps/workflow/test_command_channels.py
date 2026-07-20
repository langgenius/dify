from __future__ import annotations

from types import SimpleNamespace

import pytest

from core.app.apps.workflow.command_channels import (
    CelerySignalCommandChannel,
    CombinedCommandChannel,
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


def test_celery_signal_command_channel_send_command_is_noop() -> None:
    channel = CelerySignalCommandChannel(
        shutdown_state_getter=lambda: False,
        abort_reason="worker shutdown",
    )
    command = PauseCommand(reason="pause")

    channel.send_command(command)

    assert channel.fetch_commands() == []
