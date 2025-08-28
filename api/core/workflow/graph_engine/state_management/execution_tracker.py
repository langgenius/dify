"""
Tracker for currently executing nodes.
"""

import threading
from typing import final


@final
class ExecutionTracker:
    """
    Tracks nodes that are currently being executed.

    This replaces the ExecutingNodesManager with a cleaner interface
    focused on tracking which nodes are in progress.
    """

    def __init__(self) -> None:
        """Initialize the execution tracker."""
        self._executing_nodes: set[str] = set()
        self._lock = threading.RLock()

    def add(self, node_id: str) -> None:
        """
        Mark a node as executing.

        Args:
            node_id: The ID of the node starting execution
        """
        with self._lock:
            self._executing_nodes.add(node_id)

    def remove(self, node_id: str) -> None:
        """
        Mark a node as no longer executing.

        Args:
            node_id: The ID of the node finishing execution
        """
        with self._lock:
            self._executing_nodes.discard(node_id)

    def is_executing(self, node_id: str) -> bool:
        """
        Check if a node is currently executing.

        Args:
            node_id: The ID of the node to check

        Returns:
            True if the node is executing
        """
        with self._lock:
            return node_id in self._executing_nodes

    def is_empty(self) -> bool:
        """
        Check if no nodes are currently executing.

        Returns:
            True if no nodes are executing
        """
        with self._lock:
            return len(self._executing_nodes) == 0

    def count(self) -> int:
        """
        Get the count of currently executing nodes.

        Returns:
            Number of executing nodes
        """
        with self._lock:
            return len(self._executing_nodes)

    def get_executing_nodes(self) -> set[str]:
        """
        Get a copy of the set of executing node IDs.

        Returns:
            Set of node IDs currently executing
        """
        with self._lock:
            return self._executing_nodes.copy()

    def clear(self) -> None:
        """Clear all executing nodes."""
        with self._lock:
            self._executing_nodes.clear()
