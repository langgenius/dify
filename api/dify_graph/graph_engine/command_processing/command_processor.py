"""
Main command processor for handling external commands.
"""

import logging
from typing import Protocol, final

from ..domain.graph_execution import GraphExecution
from ..entities.commands import GraphEngineCommand
from ..protocols.command_channel import CommandChannel

logger = logging.getLogger(__name__)


class CommandHandler(Protocol):
    """Protocol for command handlers."""

    def handle(self, command: GraphEngineCommand, execution: GraphExecution) -> None: ...


@final
class CommandProcessor:
    """
    Processes external commands sent to the engine.

    This polls the command channel and dispatches commands to
    appropriate handlers.
    """

    def __init__(
        self,
        command_channel: CommandChannel,
        graph_execution: GraphExecution,
    ) -> None:
        """
        Initialize the command processor.

        Args:
            command_channel: Channel for receiving commands
            graph_execution: Graph execution aggregate
        """
        self._command_channel = command_channel
        self._graph_execution = graph_execution
        self._handlers: dict[type[GraphEngineCommand], CommandHandler] = {}

    def register_handler(self, command_type: type[GraphEngineCommand], handler: CommandHandler) -> None:
        """
        Register a handler for a command type.

        Args:
            command_type: Type of command to handle
            handler: Handler for the command
        """
        self._handlers[command_type] = handler

    def process_commands(self) -> None:
        """Check for and process any pending commands."""
        try:
            commands = self._command_channel.fetch_commands()
            for command in commands:
                self._handle_command(command)
        except Exception as e:
            logger.warning("Error processing commands: %s", e)

    def _handle_command(self, command: GraphEngineCommand) -> None:
        """
        Handle a single command.

        Args:
            command: The command to handle
        """
        handler = self._handlers.get(type(command))
        if handler:
            try:
                handler.handle(command, self._graph_execution)
            except Exception:
                logger.exception("Error handling command %s", command.__class__.__name__)
        else:
            logger.warning("No handler registered for command: %s", command.__class__.__name__)
