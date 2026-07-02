"""Command channels used by Dify workflow runners."""

import logging
import threading
from collections.abc import Sequence
from types import TracebackType
from typing import Self, final

from graphon.graph_engine.command_channels import CommandChannel, InMemoryChannel
from graphon.graph_engine.entities.commands import AbortCommand, GraphEngineCommand

logger = logging.getLogger(__name__)

WORKFLOW_WARM_SHUTDOWN_ABORT_REASON = "Workflow stopped because the worker is shutting down."
_celery_signal_channels: dict[str, "CelerySignalCommandChannel"] = {}
_celery_signal_channels_lock = threading.RLock()
_celery_warm_shutdown_abort_reason: str | None = None


@final
class CombinedCommandChannel:
    """Combine multiple command sources for a single GraphEngine instance."""

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
        self._command_channels[0].send_command(command)


@final
class CelerySignalCommandChannel:
    """Expose Celery worker shutdown as a local GraphEngine command source."""

    def __init__(self, *, task_id: str) -> None:
        if not task_id:
            raise ValueError("task_id must not be empty")
        self.task_id = task_id
        self._abort_sent = False
        self._local_channel = InMemoryChannel()

    def __enter__(self) -> Self:
        register_celery_signal_command_channel(self)
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        unregister_celery_signal_command_channel(self)

    def fetch_commands(self) -> list[GraphEngineCommand]:
        return self._local_channel.fetch_commands()

    def send_command(self, command: GraphEngineCommand) -> None:
        self._local_channel.send_command(command)

    def send_abort_command(self, *, reason: str = WORKFLOW_WARM_SHUTDOWN_ABORT_REASON) -> bool:
        if self._abort_sent:
            return False

        self._abort_sent = True
        self._local_channel.send_command(AbortCommand(reason=reason))
        return True


def register_celery_signal_command_channel(channel: CelerySignalCommandChannel) -> None:
    """Register a local command channel for Celery warm shutdown notifications."""
    with _celery_signal_channels_lock:
        _celery_signal_channels[channel.task_id] = channel
        shutdown_reason = _celery_warm_shutdown_abort_reason

    if shutdown_reason:
        channel.send_abort_command(reason=shutdown_reason)


def unregister_celery_signal_command_channel(channel: CelerySignalCommandChannel) -> None:
    """Unregister a local command channel after the workflow run exits."""
    with _celery_signal_channels_lock:
        if _celery_signal_channels.get(channel.task_id) is channel:
            del _celery_signal_channels[channel.task_id]


def send_celery_warm_shutdown_abort_commands(
    *,
    reason: str = WORKFLOW_WARM_SHUTDOWN_ABORT_REASON,
) -> int:
    """Push abort commands into all active local Celery signal channels."""
    global _celery_warm_shutdown_abort_reason
    with _celery_signal_channels_lock:
        _celery_warm_shutdown_abort_reason = reason
        channels = tuple(_celery_signal_channels.values())

    return sum(1 for channel in channels if channel.send_abort_command(reason=reason))


def get_celery_signal_command_channel_count() -> int:
    """Return the number of active local Celery signal command channels."""
    with _celery_signal_channels_lock:
        return len(_celery_signal_channels)


def reset_celery_signal_command_channels() -> None:
    """Reset local Celery signal channel state for worker initialization and tests."""
    global _celery_warm_shutdown_abort_reason
    with _celery_signal_channels_lock:
        _celery_signal_channels.clear()
        _celery_warm_shutdown_abort_reason = None
