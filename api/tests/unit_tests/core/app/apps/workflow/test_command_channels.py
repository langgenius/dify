from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from core.app.apps.execution_coordinator import send_abort_command
from core.app.apps.workflow.command_channels import (
    REMOTE_COMMAND_POLL_INTERVAL_SECONDS,
    CelerySignalCommandChannel,
    CombinedCommandChannel,
    IntervalCommandChannel,
    StopFlagCommandChannel,
    create_run_command_channel,
)
from graphon.engine.command import AbortCommand, Command, PauseCommand, RedisChannel


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


class _Clock:
    """Monotonic clock that only moves when a test advances it.

    Tests advance it in binary fractions so that sums compare exactly.
    """

    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


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


def test_interval_command_channel_first_poll_reaches_the_source() -> None:
    abort = AbortCommand(reason="stop")
    channel = IntervalCommandChannel(_CommandChannelStub([abort]), min_interval=0.5, clock=_Clock())

    assert channel.fetch_commands() == [abort]


def test_interval_command_channel_leaves_the_source_alone_until_the_interval_elapses() -> None:
    clock = _Clock()
    source = _CommandChannelStub()
    channel = IntervalCommandChannel(source, min_interval=0.5, clock=clock)
    assert channel.fetch_commands() == []
    abort = AbortCommand(reason="stop")
    source.commands.append(abort)

    clock.advance(0.125)
    assert channel.fetch_commands() == []
    clock.advance(0.25)
    assert channel.fetch_commands() == []
    assert source.commands == [abort]

    clock.advance(0.125)
    assert channel.fetch_commands() == [abort]
    assert source.commands == []


def test_interval_command_channel_measures_the_interval_from_the_last_source_poll() -> None:
    clock = _Clock()
    source = _CommandChannelStub()
    channel = IntervalCommandChannel(source, min_interval=0.5, clock=clock)
    assert channel.fetch_commands() == []
    clock.advance(0.5)
    assert channel.fetch_commands() == []
    pause = PauseCommand(reason="pause")
    source.commands.append(pause)

    clock.advance(0.375)
    assert channel.fetch_commands() == []
    clock.advance(0.125)
    assert channel.fetch_commands() == [pause]


def test_interval_command_channel_sends_without_delay() -> None:
    source = _CommandChannelStub()
    channel = IntervalCommandChannel(source, min_interval=0.5, clock=_Clock())
    assert channel.fetch_commands() == []
    command = AbortCommand(reason="stop")

    channel.send_command(command)

    assert source.sent == [command]


def test_interval_command_channel_with_zero_interval_polls_every_time() -> None:
    source = _CommandChannelStub()
    channel = IntervalCommandChannel(source, min_interval=0, clock=_Clock())
    assert channel.fetch_commands() == []
    abort = AbortCommand(reason="stop")
    source.commands.append(abort)

    assert channel.fetch_commands() == [abort]


def test_interval_command_channel_rejects_a_negative_interval() -> None:
    with pytest.raises(ValueError, match="min_interval must not be negative"):
        IntervalCommandChannel(_CommandChannelStub(), min_interval=-0.1)


def test_run_command_channel_polls_local_sources_on_every_tick_and_remote_sources_on_the_interval() -> None:
    clock = _Clock()
    remote = _CommandChannelStub()
    second_remote = _CommandChannelStub()
    local = _CommandChannelStub()
    channel = create_run_command_channel(remote_channels=(remote, second_remote), local_channels=(local,), clock=clock)
    assert channel.fetch_commands() == []
    remote_abort = AbortCommand(reason="remote stop")
    remote_pause = PauseCommand(reason="remote pause")
    local_abort = AbortCommand(reason="worker shutdown")
    remote.commands.append(remote_abort)
    second_remote.commands.append(remote_pause)
    local.commands.append(local_abort)

    clock.advance(REMOTE_COMMAND_POLL_INTERVAL_SECONDS / 4)
    assert channel.fetch_commands() == [local_abort]

    clock.advance(REMOTE_COMMAND_POLL_INTERVAL_SECONDS * 3 / 4)
    assert channel.fetch_commands() == [remote_abort, remote_pause]


def test_run_command_channel_sends_through_the_first_remote_source() -> None:
    remote = _CommandChannelStub()
    second_remote = _CommandChannelStub()
    local = _CommandChannelStub()
    channel = create_run_command_channel(remote_channels=(remote, second_remote), local_channels=(local,))
    command = AbortCommand(reason="stop")

    channel.send_command(command)

    assert remote.sent == [command]
    assert second_remote.sent == []
    assert local.sent == []


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
    channel = StopFlagCommandChannel(task_id="task-1", abort_reason="User requested stop")

    with patch("core.app.apps.workflow.command_channels.is_app_task_stop_flag_set", return_value=False):
        assert channel.fetch_commands() == []

    with patch("core.app.apps.workflow.command_channels.is_app_task_stop_flag_set", return_value=True):
        commands = channel.fetch_commands()

    assert len(commands) == 1
    assert isinstance(commands[0], AbortCommand)
    assert commands[0].reason == "User requested stop"


def test_stop_flag_command_channel_emits_abort_once_per_instance() -> None:
    channel = StopFlagCommandChannel(task_id="task-1")

    with patch("core.app.apps.workflow.command_channels.is_app_task_stop_flag_set", return_value=True):
        assert len(channel.fetch_commands()) == 1
        assert channel.fetch_commands() == []
