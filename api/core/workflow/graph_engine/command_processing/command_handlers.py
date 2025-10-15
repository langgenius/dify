"""
Command handler implementations.
"""

import logging
from typing import final

from typing_extensions import override

from ..domain.graph_execution import GraphExecution
from ..entities.commands import AbortCommand, GraphEngineCommand
from .command_processor import CommandHandler

logger = logging.getLogger(__name__)


@final
class AbortCommandHandler(CommandHandler):
    """Handles abort commands."""

    @override
    def handle(self, command: GraphEngineCommand, execution: GraphExecution) -> None:
        """
        Handle an abort command.

        Args:
            command: The abort command
            execution: Graph execution to abort
        """
        assert isinstance(command, AbortCommand)
        logger.debug("Aborting workflow %s: %s", execution.workflow_id, command.reason)
        execution.abort(command.reason or "User requested abort")
