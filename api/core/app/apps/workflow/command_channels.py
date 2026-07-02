"""Command channels used by Dify workflow runners."""

import logging
import threading
from collections.abc import Sequence
from typing import final, override

from core.app.apps.workflow.active_workflow_tasks import get_active_workflow_task_count
from graphon.graph_engine.command_channels import CommandChannel
from graphon.graph_engine.entities.commands import AbortCommand, GraphEngineCommand

logger = logging.getLogger(__name__)

WORKFLOW_WARM_SHUTDOWN_ABORT_REASON = "Workflow stopped because the worker is shutting down."
_celery_warm_shutdown_lock = threading.RLock()
_celery_warm_shutdown_abort_command: AbortCommand | None = None


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
    """Expose the process-wide Celery warm shutdown command to one GraphEngine instance."""

    @override
    def fetch_commands(self) -> list[GraphEngineCommand]:
        with _celery_warm_shutdown_lock:
            abort_command = _celery_warm_shutdown_abort_command

        if abort_command is None:
            return []
        return [abort_command]

    @override
    def send_command(self, command: GraphEngineCommand) -> None:
        _ = command


def send_celery_warm_shutdown_abort_commands(
    *,
    reason: str = WORKFLOW_WARM_SHUTDOWN_ABORT_REASON,
) -> int:
    """Set the process-wide abort command and return the current active workflow run count."""
    global _celery_warm_shutdown_abort_command
    with _celery_warm_shutdown_lock:
        _celery_warm_shutdown_abort_command = AbortCommand(reason=reason)

    return get_active_workflow_task_count()


def reset_celery_warm_shutdown_state() -> None:
    """Reset local Celery warm shutdown abort state for worker initialization and tests."""
    global _celery_warm_shutdown_abort_command
    with _celery_warm_shutdown_lock:
        _celery_warm_shutdown_abort_command = None
