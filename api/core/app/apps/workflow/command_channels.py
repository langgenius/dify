"""Command channels used by Dify workflow runners."""

import logging
from collections.abc import Callable, Sequence
from typing import final, override

from extensions.ext_redis import redis_client
from graphon.engine.command import AbortCommand, Command, CommandChannel, RedisChannel

logger = logging.getLogger(__name__)
ShutdownStateGetter = Callable[[], bool]


def send_abort_command(task_id: str, reason: str | None = None) -> None:
    """Send an abort command to the workflow engine serving ``task_id``."""
    if not task_id:
        return

    try:
        RedisChannel(redis_client, f"workflow:{task_id}:commands").send_command(
            AbortCommand(reason=reason or "User requested stop")
        )
    except Exception:
        # The legacy stop flag remains the fallback when Redis is unavailable.
        logger.exception("Failed to send Engine abort command for task %s", task_id)


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
