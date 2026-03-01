"""
In-memory implementation of CommandChannel for local/testing scenarios.

This implementation uses a thread-safe queue for command communication
within a single process. Each instance handles commands for one workflow execution.
"""

from queue import Queue
from typing import final

from ..entities.commands import GraphEngineCommand


@final
class InMemoryChannel:
    """
    In-memory command channel implementation using a thread-safe queue.

    Each instance is dedicated to a single GraphEngine/workflow execution.
    Suitable for local development, testing, and single-instance deployments.
    """

    def __init__(self) -> None:
        """Initialize the in-memory channel with a single queue."""
        self._queue: Queue[GraphEngineCommand] = Queue()

    def fetch_commands(self) -> list[GraphEngineCommand]:
        """
        Fetch all pending commands from the queue.

        Returns:
            List of pending commands (drains the queue)
        """
        commands: list[GraphEngineCommand] = []

        # Drain all available commands from the queue
        while not self._queue.empty():
            try:
                command = self._queue.get_nowait()
                commands.append(command)
            except Exception:
                break

        return commands

    def send_command(self, command: GraphEngineCommand) -> None:
        """
        Send a command to this channel's queue.

        Args:
            command: The command to send
        """
        self._queue.put(command)
