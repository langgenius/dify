"""
Base error strategy protocol.
"""

from typing import Protocol

from core.workflow.graph import Graph
from core.workflow.graph_events import GraphNodeEventBase, NodeRunFailedEvent


class ErrorStrategy(Protocol):
    """
    Protocol for error handling strategies.

    Each strategy implements a different approach to handling
    node execution failures.
    """

    def handle_error(self, event: NodeRunFailedEvent, graph: Graph, retry_count: int) -> GraphNodeEventBase | None:
        """
        Handle a node failure event.

        Args:
            event: The failure event
            graph: The workflow graph
            retry_count: Current retry attempt count

        Returns:
            Optional new event to process, or None to stop
        """
        ...
