"""
ExecutingNodesManager - Thread-safe manager for tracking executing nodes.

This class encapsulates the management of executing nodes with proper locking
to avoid repetitive lock patterns throughout the code.
"""

import threading


class ExecutingNodesManager:
    """
    Thread-safe manager for tracking nodes currently being executed.

    This class provides a clean interface for managing the set of executing nodes
    with automatic locking to ensure thread safety.
    """

    def __init__(self) -> None:
        """Initialize the executing nodes manager."""
        self._executing_nodes: set[str] = set()
        self._lock = threading.Lock()

    def add(self, node_id: str) -> None:
        """
        Add a node to the executing set.

        Args:
            node_id: The ID of the node to add
        """
        with self._lock:
            self._executing_nodes.add(node_id)

    def remove(self, node_id: str) -> None:
        """
        Remove a node from the executing set.

        Args:
            node_id: The ID of the node to remove
        """
        with self._lock:
            self._executing_nodes.discard(node_id)  # Use discard to avoid KeyError

    def is_empty(self) -> bool:
        """
        Check if there are no executing nodes.

        Returns:
            True if no nodes are executing, False otherwise
        """
        with self._lock:
            return len(self._executing_nodes) == 0
