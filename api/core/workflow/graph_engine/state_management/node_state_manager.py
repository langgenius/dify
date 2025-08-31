"""
Manager for node states during graph execution.
"""

import queue
import threading
from typing import final

from core.workflow.enums import NodeState
from core.workflow.graph import Graph


@final
class NodeStateManager:
    """
    Manages node states and the ready queue for execution.

    This centralizes node state transitions and enqueueing logic,
    ensuring thread-safe operations on node states.
    """

    def __init__(self, graph: Graph, ready_queue: queue.Queue[str]) -> None:
        """
        Initialize the node state manager.

        Args:
            graph: The workflow graph
            ready_queue: Queue for nodes ready to execute
        """
        self.graph = graph
        self.ready_queue = ready_queue
        self._lock = threading.RLock()

    def enqueue_node(self, node_id: str) -> None:
        """
        Mark a node as TAKEN and add it to the ready queue.

        This combines the state transition and enqueueing operations
        that always occur together when preparing a node for execution.

        Args:
            node_id: The ID of the node to enqueue
        """
        with self._lock:
            self.graph.nodes[node_id].state = NodeState.TAKEN
            self.ready_queue.put(node_id)

    def mark_node_skipped(self, node_id: str) -> None:
        """
        Mark a node as SKIPPED.

        Args:
            node_id: The ID of the node to skip
        """
        with self._lock:
            self.graph.nodes[node_id].state = NodeState.SKIPPED

    def is_node_ready(self, node_id: str) -> bool:
        """
        Check if a node is ready to be executed.

        A node is ready when all its incoming edges from taken branches
        have been satisfied.

        Args:
            node_id: The ID of the node to check

        Returns:
            True if the node is ready for execution
        """
        with self._lock:
            # Get all incoming edges to this node
            incoming_edges = self.graph.get_incoming_edges(node_id)

            # If no incoming edges, node is always ready
            if not incoming_edges:
                return True

            # If any edge is UNKNOWN, node is not ready
            if any(edge.state == NodeState.UNKNOWN for edge in incoming_edges):
                return False

            # Node is ready if at least one edge is TAKEN
            return any(edge.state == NodeState.TAKEN for edge in incoming_edges)

    def get_node_state(self, node_id: str) -> NodeState:
        """
        Get the current state of a node.

        Args:
            node_id: The ID of the node

        Returns:
            The current node state
        """
        with self._lock:
            return self.graph.nodes[node_id].state
