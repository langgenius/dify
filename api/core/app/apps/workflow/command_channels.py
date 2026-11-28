"""Command channels used by Dify workflow runners."""

import logging
import time
from collections.abc import Callable, Sequence
from typing import final, override

from core.app.apps.execution_coordinator import is_app_task_stop_flag_set
from graphon.engine.command import AbortCommand, Command, CommandChannel

logger = logging.getLogger(__name__)
ShutdownStateGetter = Callable[[], bool]

# The Engine dispatcher asks for commands every 100 ms while a run waits on a node. Sources that
# need a Redis round trip per poll are asked at this interval instead, which bounds how late a
# stop, pause or variable update reaches the Engine.
REMOTE_COMMAND_POLL_INTERVAL_SECONDS = 0.5


@final
class CombinedCommandChannel:
    """Fetch commands from all sources and send outbound commands through the primary source."""

    _command_channels: tuple[CommandChannel, ...]

    def __init__(self, command_channels: Sequence[CommandChannel]) -> None:
        if not command_channels:
            raise ValueError("command_channels must not be empty")
        self._command_channels = tuple(command_channels)

    def fetch_commands(self) -> list[Command]:
        commands: list[Command] = []
        for channel in self._command_channels:
            try:
                commands.extend(channel.fetch_commands())
            except Exception:
                logger.exception("Failed to fetch Engine commands from %s", channel.__class__.__name__)
        return commands

    def send_command(self, command: Command) -> None:
        """Send commands through the first channel, which is the runner's primary command sink."""
        self._command_channels[0].send_command(command)


@final
class IntervalCommandChannel(CommandChannel):
    """Ask a command source for commands at most once per ``min_interval`` seconds.

    Every in-flight run polls its command channel for as long as it runs, so a source that
    costs a network round trip per poll is paid for by every run that is only waiting on a
    node. Polls that arrive before the interval has elapsed return no commands and do not
    touch the source; the commands stay queued in the source and are returned by the next
    poll that does.

    Postcondition: a command that is available in the source is returned no later than
    ``min_interval`` seconds after the previous poll that reached the source. The first poll
    always reaches the source. Sending is not delayed.
    """

    _inner: CommandChannel
    _min_interval: float
    _clock: Callable[[], float]
    _next_fetch_at: float | None

    def __init__(
        self,
        inner: CommandChannel,
        *,
        min_interval: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if min_interval < 0:
            raise ValueError("min_interval must not be negative")
        self._inner = inner
        self._min_interval = min_interval
        self._clock = clock
        self._next_fetch_at = None

    @override
    def fetch_commands(self) -> list[Command]:
        now = self._clock()
        if self._next_fetch_at is not None and now < self._next_fetch_at:
            return []

        self._next_fetch_at = now + self._min_interval
        return self._inner.fetch_commands()

    @override
    def send_command(self, command: Command) -> None:
        self._inner.send_command(command)


def create_run_command_channel(
    *,
    remote_channels: Sequence[CommandChannel],
    local_channels: Sequence[CommandChannel],
    clock: Callable[[], float] = time.monotonic,
) -> CombinedCommandChannel:
    """Combine the command sources of one run.

    ``remote_channels`` need a network round trip per poll and are polled together every
    ``REMOTE_COMMAND_POLL_INTERVAL_SECONDS``; the first of them receives outbound commands.
    ``local_channels`` read process-local state and are polled on every dispatcher tick.
    """
    return CombinedCommandChannel(
        (
            IntervalCommandChannel(
                CombinedCommandChannel(remote_channels),
                min_interval=REMOTE_COMMAND_POLL_INTERVAL_SECONDS,
                clock=clock,
            ),
            *local_channels,
        )
    )


@final
class CelerySignalCommandChannel(CommandChannel):
    """Translate process-local Celery shutdown state into one Engine abort command."""

    _shutdown_state_getter: ShutdownStateGetter
    _abort_reason: str
    _abort_emitted: bool

    def __init__(
        self,
        *,
        shutdown_state_getter: ShutdownStateGetter,
        abort_reason: str,
    ) -> None:
        self._shutdown_state_getter = shutdown_state_getter
        self._abort_reason = abort_reason
        self._abort_emitted = False

    @override
    def fetch_commands(self) -> list[Command]:
        if self._abort_emitted or not self._shutdown_state_getter():
            return []

        self._abort_emitted = True
        return [AbortCommand(reason=self._abort_reason)]

    @override
    def send_command(self, command: Command) -> None:
        _ = command


@final
class StopFlagCommandChannel(CommandChannel):
    """Translate the legacy Redis stop flag into one GraphEngine abort command."""

    _task_id: str
    _abort_reason: str
    _abort_emitted: bool

    def __init__(
        self,
        *,
        task_id: str,
        abort_reason: str = "User requested stop",
    ) -> None:
        self._task_id = task_id
        self._abort_reason = abort_reason
        self._abort_emitted = False

    @override
    def fetch_commands(self) -> list[Command]:
        if self._abort_emitted or not is_app_task_stop_flag_set(self._task_id):
            return []

        self._abort_emitted = True
        return [AbortCommand(reason=self._abort_reason)]

    @override
    def send_command(self, command: Command) -> None:
        _ = command
