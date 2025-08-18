"""
Abort error strategy implementation.
"""

import logging
from typing import Optional

from core.workflow.graph import Graph
from core.workflow.graph_events import GraphNodeEventBase, NodeRunFailedEvent

logger = logging.getLogger(__name__)


class AbortStrategy:
    """
    Error strategy that aborts execution on failure.

    This is the default strategy when no other strategy is specified.
    It stops the entire graph execution when a node fails.
    """

    def handle_error(self, event: NodeRunFailedEvent, graph: Graph, retry_count: int) -> Optional[GraphNodeEventBase]:
        """
        Handle error by aborting execution.

        Args:
            event: The failure event
            graph: The workflow graph
            retry_count: Current retry attempt count (unused)

        Returns:
            None - signals abortion
        """
        logger.error("Node %s failed with ABORT strategy: %s", event.node_id, event.error)

        # Return None to signal that execution should stop
        return None
