"""CommandChannel protocol for Engine command communication.

This protocol defines the interface for sending and receiving commands
to/from an Engine instance, supporting both local and distributed scenarios.
"""

from typing import Protocol

from .entities import Command


class CommandChannel(Protocol):
    """Protocol for bidirectional command communication with Engine.

    Since each Engine instance processes only one workflow execution,
    this channel is dedicated to that single execution.
    """

    def fetch_commands(self) -> list[Command]:
        """Fetch pending commands for this Engine instance.

        Called by Engine to poll for commands that need to be processed.

        Returns:
            List of pending commands (may be empty)

        """
        ...

    def send_command(self, command: Command) -> None:
        """Send a command to be processed by this Engine instance.

        Called by external systems to send control commands to the running workflow.

        Args:
            command: The command to send

        """
        ...
