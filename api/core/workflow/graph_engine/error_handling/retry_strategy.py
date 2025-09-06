"""
Retry error strategy implementation.
"""

import time
from typing import final

from core.workflow.graph import Graph
from core.workflow.graph_events import GraphNodeEventBase, NodeRunFailedEvent, NodeRunRetryEvent


@final
class RetryStrategy:
    """
    Error strategy that retries failed nodes.

    This strategy re-attempts node execution up to a configured
    maximum number of retries with configurable intervals.
    """

    def handle_error(self, event: NodeRunFailedEvent, graph: Graph, retry_count: int) -> GraphNodeEventBase | None:
        """
        Handle error by retrying the node.

        Args:
            event: The failure event
            graph: The workflow graph
            retry_count: Current retry attempt count

        Returns:
            NodeRunRetryEvent if retry should occur, None otherwise
        """
        node = graph.nodes[event.node_id]

        # Check if we've exceeded max retries
        if not node.retry or retry_count >= node.retry_config.max_retries:
            return None

        # Wait for retry interval
        time.sleep(node.retry_config.retry_interval_seconds)

        # Create retry event
        return NodeRunRetryEvent(
            id=event.id,
            node_title=node.title,
            node_id=event.node_id,
            node_type=event.node_type,
            node_run_result=event.node_run_result,
            start_at=event.start_at,
            error=event.error,
            retry_index=retry_count + 1,
        )
