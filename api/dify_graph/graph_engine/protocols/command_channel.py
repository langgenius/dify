"""
CommandChannel protocol for GraphEngine command communication.

This protocol defines the interface for sending and receiving commands
to/from a GraphEngine instance, supporting both local and distributed scenarios.
"""

from typing import Protocol

from ..entities.commands import GraphEngineCommand


class CommandChannel(Protocol):
    """
    Protocol for bidirectional command communication with GraphEngine.

    Since each GraphEngine instance processes only one workflow execution,
    this channel is dedicated to that single execution.
    """

    def fetch_commands(self) -> list[GraphEngineCommand]:
        """
        Fetch pending commands for this GraphEngine instance.

        Called by GraphEngine to poll for commands that need to be processed.

        Returns:
            List of pending commands (may be empty)
        """
        ...

    def send_command(self, command: GraphEngineCommand) -> None:
        """
        Send a command to be processed by this GraphEngine instance.

        Called by external systems to send control commands to the running workflow.

        Args:
            command: The command to send
        """
        ...
