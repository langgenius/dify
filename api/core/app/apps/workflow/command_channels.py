"""Command channels used by Dify workflow runners."""

import logging
from collections.abc import Sequence
from typing import final, override

from graphon.graph_engine.command_channels import CommandChannel
from graphon.graph_engine.entities.commands import AbortCommand, GraphEngineCommand

logger = logging.getLogger(__name__)
_abort_command: AbortCommand | None = None


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
    """Expose process-local commands set by Celery signal handlers to one GraphEngine instance."""

    @override
    def fetch_commands(self) -> list[GraphEngineCommand]:
        if _abort_command is None:
            return []
        return [_abort_command]

    @override
    def send_command(self, command: GraphEngineCommand) -> None:
        _ = command


def set_abort_command(command: AbortCommand) -> None:
    """Set the process-local abort command used by Celery signal command channels."""
    global _abort_command
    _abort_command = command


def reset_abort_command() -> None:
    """Reset the process-local abort command used by Celery signal command channels."""
    global _abort_command
    _abort_command = None
