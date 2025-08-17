"""
Command handler implementations.
"""

import logging

from ..domain.graph_execution import GraphExecution
from ..entities.commands import AbortCommand

logger = logging.getLogger(__name__)


class AbortCommandHandler:
    """Handles abort commands."""

    def handle(self, command: AbortCommand, execution: GraphExecution) -> None:
        """
        Handle an abort command.

        Args:
            command: The abort command
            execution: Graph execution to abort
        """
        logger.debug("Aborting workflow %s: %s", execution.workflow_id, command.reason)
        execution.abort(command.reason or "User requested abort")
