"""Command channels used by Dify workflow runners."""

import logging
from collections.abc import Callable, Sequence
from typing import final, override

from graphon.entities.pause_reason import PauseReason, SchedulingPause
from graphon.graph_engine.command_channels import CommandChannel
from graphon.graph_engine.entities.commands import AbortCommand, GraphEngineCommand, PauseCommand

logger = logging.getLogger(__name__)
ShutdownStateGetter = Callable[[], bool]

WORKFLOW_WARM_SHUTDOWN_ABORT_REASON = "Workflow stopped because the worker is shutting down."
WORKFLOW_WARM_SHUTDOWN_PAUSE_REASON = "Workflow paused because the worker is shutting down."


def is_workflow_warm_shutdown_pause(reasons: Sequence[PauseReason]) -> bool:
    """Return whether a graph pause was requested by Celery worker drain.

    Graphon 0.6 represents a scheduling pause with only a free-form message.
    Keep the comparison behind this adapter so callers do not duplicate that
    compatibility detail while Dify moves toward a structured pause origin.
    """
    return bool(reasons) and all(
        isinstance(reason, SchedulingPause) and reason.message == WORKFLOW_WARM_SHUTDOWN_PAUSE_REASON
        for reason in reasons
    )


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

        abort_commands = [command for command in commands if isinstance(command, AbortCommand)]
        if not abort_commands:
            return commands

        # Abort is terminal and must win when a user Stop races a worker-drain
        # pause. Also keep a user Abort reason ahead of the shutdown fallback
        # when handoff is disabled.
        has_non_shutdown_abort = any(
            command.reason != WORKFLOW_WARM_SHUTDOWN_ABORT_REASON for command in abort_commands
        )
        return [
            command
            for command in commands
            if not isinstance(command, PauseCommand)
            and not (
                has_non_shutdown_abort
                and isinstance(command, AbortCommand)
                and command.reason == WORKFLOW_WARM_SHUTDOWN_ABORT_REASON
            )
        ]

    def send_command(self, command: GraphEngineCommand) -> None:
        """Send commands through the first channel, which is the runner's primary command sink."""
        self._command_channels[0].send_command(command)


@final
class CelerySignalCommandChannel(CommandChannel):
    """Translate process-local Celery shutdown state into one GraphEngine control command."""

    _shutdown_state_getter: ShutdownStateGetter
    _pause_on_shutdown: bool
    _ignore_shutdown: bool
    _command_emitted: bool

    def __init__(
        self,
        *,
        shutdown_state_getter: ShutdownStateGetter,
        pause_on_shutdown: bool,
        ignore_shutdown: bool = False,
    ) -> None:
        if pause_on_shutdown and ignore_shutdown:
            raise ValueError("pause_on_shutdown and ignore_shutdown are mutually exclusive")
        self._shutdown_state_getter = shutdown_state_getter
        self._pause_on_shutdown = pause_on_shutdown
        self._ignore_shutdown = ignore_shutdown
        self._command_emitted = False

    @override
    def fetch_commands(self) -> list[GraphEngineCommand]:
        if self._command_emitted or not self._shutdown_state_getter():
            return []

        self._command_emitted = True
        if self._ignore_shutdown:
            # Nested Workflow-as-Tool execution must drain back into its parent
            # node. The top-level graph then checkpoints the complete result at
            # the next safe scheduling boundary.
            return []
        if self._pause_on_shutdown:
            return [PauseCommand(reason=WORKFLOW_WARM_SHUTDOWN_PAUSE_REASON)]
        return [AbortCommand(reason=WORKFLOW_WARM_SHUTDOWN_ABORT_REASON)]

    @override
    def send_command(self, command: GraphEngineCommand) -> None:
        _ = command
