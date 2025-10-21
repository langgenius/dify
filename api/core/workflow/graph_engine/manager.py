"""
GraphEngine Manager for sending control commands via Redis channel.

This module provides a simplified interface for controlling workflow executions
using the new Redis command channel, without requiring user permission checks.
Supports stop, pause, and resume operations.
"""

from typing import final

from core.workflow.graph_engine.command_channels.redis_channel import RedisChannel
from core.workflow.graph_engine.entities.commands import AbortCommand, GraphEngineCommand, PauseCommand
from extensions.ext_redis import redis_client


@final
class GraphEngineManager:
    """
    Manager for sending control commands to GraphEngine instances.

    This class provides a simple interface for controlling workflow executions
    by sending commands through Redis channels, without user validation.
    Supports stop and pause operations.
    """

    @staticmethod
    def send_stop_command(task_id: str, reason: str | None = None) -> None:
        """
        Send a stop command to a running workflow.

        Args:
            task_id: The task ID of the workflow to stop
            reason: Optional reason for stopping (defaults to "User requested stop")
        """
        abort_command = AbortCommand(reason=reason or "User requested stop")
        GraphEngineManager._send_command(task_id, abort_command)

    @staticmethod
    def send_pause_command(task_id: str, reason: str | None = None) -> None:
        """Send a pause command to a running workflow."""

        pause_command = PauseCommand(reason=reason or "User requested pause")
        GraphEngineManager._send_command(task_id, pause_command)

    @staticmethod
    def _send_command(task_id: str, command: GraphEngineCommand) -> None:
        """Send a command to the workflow-specific Redis channel."""

        if not task_id:
            return

        channel_key = f"workflow:{task_id}:commands"
        channel = RedisChannel(redis_client, channel_key)

        try:
            channel.send_command(command)
        except Exception:
            # Silently fail if Redis is unavailable
            # The legacy control mechanisms will still work
            pass
