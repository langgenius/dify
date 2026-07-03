"""Command channels used by Dify workflow runners."""

import logging
from collections.abc import Callable, Sequence
from typing import final, override

from graphon.graph_engine.command_channels import CommandChannel
from graphon.graph_engine.entities.commands import AbortCommand, GraphEngineCommand

logger = logging.getLogger(__name__)
ShutdownStateGetter = Callable[[], bool]


@final
class CombinedCommandChannel:
    """Fetch commands from all sources and send outbound commands through the primary source."""

    _command_channels: tuple[CommandChannel, ...]

    def __init__(self, command_channels: Sequence[CommandChannel]) -> None:
        if not command_channels:
            raise ValueError("command_channels must not be empty")
        self._command_channels = tuple(command_channels)

    def fetch_commands(self) -> list[GraphEngineCommand]:
        commands: list[GraphEngineCommand] = []
        for channel in self._command_channels:
            try:
                commands.extend(channel.fetch_commands())
            except Exception:
                logger.exception("Failed to fetch GraphEngine commands from %s", channel.__class__.__name__)
        return commands

    def send_command(self, command: GraphEngineCommand) -> None:
        """Send commands through the first channel, which is the runner's primary command sink."""
        self._command_channels[0].send_command(command)


@final
class CelerySignalCommandChannel(CommandChannel):
    """Translate process-local Celery shutdown state into one GraphEngine abort command."""

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
    def fetch_commands(self) -> list[GraphEngineCommand]:
        if self._abort_emitted or not self._shutdown_state_getter():
            return []

        self._abort_emitted = True
        return [AbortCommand(reason=self._abort_reason)]

    @override
    def send_command(self, command: GraphEngineCommand) -> None:
        _ = command
