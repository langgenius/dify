"""
ResponseStreamCoordinator - Coordinates streaming output from response nodes

This component manages dependency tracking for response nodes (Answer/End nodes)
and ensures proper serialization of user-visible streaming output.
"""

from threading import RLock
from typing import Any


class ResponseStreamCoordinator:
    """
    Coordinates streaming output from response nodes with dependency management.

    Manages response node dependencies and ensures exactly one active session
    at a time for proper streaming output serialization.
    """

    def __init__(self) -> None:
        """Initialize empty coordinator with thread-safe storage."""
        self._lock = RLock()

        # dep_map: ResponseNode.id -> {deps, unresolved, cancelled}
        self._dep_map: dict[str, dict[str, Any]] = {}

        # edge_to_responses: reverse index for O(1) edge updates
        self._edge_to_responses: dict[str, set[str]] = {}

        # Active session tracking
        self._active_session: str | None = None

        # Registered response nodes
        self._response_nodes: set[str] = set()

    def register(self, response_node_id: str, dependencies: list[str] | None = None) -> None:
        """
        Register a response node with its dependencies.

        Args:
            response_node_id: ID of the response node to register
            dependencies: List of edge IDs this node depends on (optional)
        """
        with self._lock:
            deps = dependencies or []

            # Initialize dependency tracking
            self._dep_map[response_node_id] = {"deps": set(deps), "unresolved": set(deps), "cancelled": False}

            # Add to response nodes set
            self._response_nodes.add(response_node_id)

            # Update reverse index
            for edge_id in deps:
                if edge_id not in self._edge_to_responses:
                    self._edge_to_responses[edge_id] = set()
                self._edge_to_responses[edge_id].add(response_node_id)

            # If no dependencies, can start immediately
            if not deps:
                self._try_start_session(response_node_id)

    def on_edge_update(self, edge_id: str) -> None:
        """
        Handle edge completion - decrements unresolved count for dependent response nodes.

        Args:
            edge_id: ID of the completed edge
        """
        with self._lock:
            # Find all response nodes that depend on this edge
            dependent_nodes = self._edge_to_responses.get(edge_id, set())

            for node_id in dependent_nodes:
                if node_id in self._dep_map and not self._dep_map[node_id]["cancelled"]:
                    # Remove from unresolved dependencies
                    self._dep_map[node_id]["unresolved"].discard(edge_id)

                    # If all dependencies resolved, try to start session
                    if not self._dep_map[node_id]["unresolved"]:
                        self._try_start_session(node_id)

    def start_session(self, node_id: str) -> bool:
        """
        Explicitly start a session for a response node.

        Args:
            node_id: ID of the response node

        Returns:
            True if session started successfully, False otherwise
        """
        with self._lock:
            return self._try_start_session(node_id)

    def end_session(self, node_id: str) -> None:
        """
        End the active session for a response node.

        Args:
            node_id: ID of the response node ending its session
        """
        with self._lock:
            if self._active_session == node_id:
                self._active_session = None

    def cancel_node(self, node_id: str) -> None:
        """
        Cancel a response node (mark as cancelled).

        Args:
            node_id: ID of the response node to cancel
        """
        with self._lock:
            if node_id in self._dep_map:
                self._dep_map[node_id]["cancelled"] = True

            # If this was the active session, end it
            if self._active_session == node_id:
                self._active_session = None

    def get_active_session(self) -> str | None:
        """
        Get the currently active session node ID.

        Returns:
            ID of the active response node, or None if no active session
        """
        with self._lock:
            return self._active_session

    def is_response_node(self, node_id: str) -> bool:
        """
        Check if a node is registered as a response node.

        Args:
            node_id: ID of the node to check

        Returns:
            True if the node is a registered response node
        """
        with self._lock:
            return node_id in self._response_nodes

    def get_node_status(self, node_id: str) -> dict[str, Any] | None:
        """
        Get the status of a response node.

        Args:
            node_id: ID of the response node

        Returns:
            Status dictionary with deps, unresolved, cancelled, or None if not found
        """
        with self._lock:
            return self._dep_map.get(node_id, {}).copy() if node_id in self._dep_map else None

    def _try_start_session(self, node_id: str) -> bool:
        """
        Try to start a session for a response node (internal method).

        Args:
            node_id: ID of the response node

        Returns:
            True if session started successfully, False otherwise
        """
        # This method assumes the lock is already held

        # Check if node is valid and not cancelled
        if node_id not in self._dep_map or self._dep_map[node_id]["cancelled"] or self._dep_map[node_id]["unresolved"]:
            return False

        # Check if there's already an active session
        if self._active_session is not None:
            return False

        # Start the session
        self._active_session = node_id
        return True

    def serialize(self) -> dict[str, Any]:
        """
        Serialize the coordinator state.

        Returns:
            Dictionary containing coordinator state
        """
        with self._lock:
            return {
                "dep_map": {k: v.copy() for k, v in self._dep_map.items()},
                "edge_to_responses": {k: list(v) for k, v in self._edge_to_responses.items()},
                "active_session": self._active_session,
                "response_nodes": list(self._response_nodes),
            }

    @classmethod
    def deserialize(cls, data: dict[str, Any]) -> "ResponseStreamCoordinator":
        """
        Create a ResponseStreamCoordinator from serialized data.

        Args:
            data: Dictionary containing serialized coordinator data

        Returns:
            New ResponseStreamCoordinator instance with the deserialized data
        """
        coordinator = cls()
        coordinator._dep_map = data.get("dep_map", {})
        coordinator._edge_to_responses = {k: set(v) for k, v in data.get("edge_to_responses", {}).items()}
        coordinator._active_session = data.get("active_session")
        coordinator._response_nodes = set(data.get("response_nodes", []))
        return coordinator
