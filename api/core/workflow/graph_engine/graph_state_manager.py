"""
Graph state manager that combines node, edge, and execution tracking.
"""

import threading
from collections.abc import Sequence
from typing import TypedDict, final

from core.workflow.enums import NodeState
from core.workflow.graph import Edge, Graph

from .ready_queue import ReadyQueue


class EdgeStateAnalysis(TypedDict):
    """Analysis result for edge states."""

    has_unknown: bool
    has_taken: bool
    all_skipped: bool


@final
class GraphStateManager:
    def __init__(self, graph: Graph, ready_queue: ReadyQueue) -> None:
        """
        Initialize the state manager.

        Args:
            graph: The workflow graph
            ready_queue: Queue for nodes ready to execute
        """
        self._graph = graph
        self._ready_queue = ready_queue
        self._lock = threading.RLock()

        # Execution tracking state
        self._executing_nodes: set[str] = set()

    # ============= Node State Operations =============

    def enqueue_node(self, node_id: str) -> None:
        """
        Mark a node as TAKEN and add it to the ready queue.

        This combines the state transition and enqueueing operations
        that always occur together when preparing a node for execution.

        Args:
            node_id: The ID of the node to enqueue
        """
        with self._lock:
            self._graph.nodes[node_id].state = NodeState.TAKEN
            self._ready_queue.put(node_id)

    def mark_node_skipped(self, node_id: str) -> None:
        """
        Mark a node as SKIPPED.

        Args:
            node_id: The ID of the node to skip
        """
        with self._lock:
            self._graph.nodes[node_id].state = NodeState.SKIPPED

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
            incoming_edges = self._graph.get_incoming_edges(node_id)

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
            return self._graph.nodes[node_id].state

    # ============= Edge State Operations =============

    def mark_edge_taken(self, edge_id: str) -> None:
        """
        Mark an edge as TAKEN.

        Args:
            edge_id: The ID of the edge to mark
        """
        with self._lock:
            self._graph.edges[edge_id].state = NodeState.TAKEN

    def mark_edge_skipped(self, edge_id: str) -> None:
        """
        Mark an edge as SKIPPED.

        Args:
            edge_id: The ID of the edge to mark
        """
        with self._lock:
            self._graph.edges[edge_id].state = NodeState.SKIPPED

    def analyze_edge_states(self, edges: list[Edge]) -> EdgeStateAnalysis:
        """
        Analyze the states of edges and return summary flags.

        Args:
            edges: List of edges to analyze

        Returns:
            Analysis result with state flags
        """
        with self._lock:
            states = {edge.state for edge in edges}

            return EdgeStateAnalysis(
                has_unknown=NodeState.UNKNOWN in states,
                has_taken=NodeState.TAKEN in states,
                all_skipped=states == {NodeState.SKIPPED} if states else True,
            )

    def get_edge_state(self, edge_id: str) -> NodeState:
        """
        Get the current state of an edge.

        Args:
            edge_id: The ID of the edge

        Returns:
            The current edge state
        """
        with self._lock:
            return self._graph.edges[edge_id].state

    def categorize_branch_edges(self, node_id: str, selected_handle: str) -> tuple[Sequence[Edge], Sequence[Edge]]:
        """
        Categorize branch edges into selected and unselected.

        Args:
            node_id: The ID of the branch node
            selected_handle: The handle of the selected edge

        Returns:
            A tuple of (selected_edges, unselected_edges)
        """
        with self._lock:
            outgoing_edges = self._graph.get_outgoing_edges(node_id)
            selected_edges: list[Edge] = []
            unselected_edges: list[Edge] = []

            for edge in outgoing_edges:
                if edge.source_handle == selected_handle:
                    selected_edges.append(edge)
                else:
                    unselected_edges.append(edge)

            return selected_edges, unselected_edges

    # ============= Execution Tracking Operations =============

    def start_execution(self, node_id: str) -> None:
        """
        Mark a node as executing.

        Args:
            node_id: The ID of the node starting execution
        """
        with self._lock:
            self._executing_nodes.add(node_id)

    def finish_execution(self, node_id: str) -> None:
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

    def get_executing_count(self) -> int:
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

    def clear_executing(self) -> None:
        """Clear all executing nodes."""
        with self._lock:
            self._executing_nodes.clear()

    # ============= Composite Operations =============

    def is_execution_complete(self) -> bool:
        """
        Check if graph execution is complete.

        Execution is complete when:
        - Ready queue is empty
        - No nodes are executing

        Returns:
            True if execution is complete
        """
        with self._lock:
            return self._ready_queue.empty() and len(self._executing_nodes) == 0

    def get_queue_depth(self) -> int:
        """
        Get the current depth of the ready queue.

        Returns:
            Number of nodes in the ready queue
        """
        return self._ready_queue.qsize()

    def get_execution_stats(self) -> dict[str, int]:
        """
        Get execution statistics.

        Returns:
            Dictionary with execution statistics
        """
        with self._lock:
            taken_nodes = sum(1 for node in self._graph.nodes.values() if node.state == NodeState.TAKEN)
            skipped_nodes = sum(1 for node in self._graph.nodes.values() if node.state == NodeState.SKIPPED)
            unknown_nodes = sum(1 for node in self._graph.nodes.values() if node.state == NodeState.UNKNOWN)

            return {
                "queue_depth": self._ready_queue.qsize(),
                "executing": len(self._executing_nodes),
                "taken_nodes": taken_nodes,
                "skipped_nodes": skipped_nodes,
                "unknown_nodes": unknown_nodes,
            }
