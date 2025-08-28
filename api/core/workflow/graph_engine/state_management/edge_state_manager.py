"""
Manager for edge states during graph execution.
"""

import threading
from collections.abc import Sequence
from typing import TypedDict, final

from core.workflow.enums import NodeState
from core.workflow.graph import Edge, Graph


class EdgeStateAnalysis(TypedDict):
    """Analysis result for edge states."""

    has_unknown: bool
    has_taken: bool
    all_skipped: bool


@final
class EdgeStateManager:
    """
    Manages edge states and transitions during graph execution.

    This handles edge state changes and provides analysis of edge
    states for decision making during execution.
    """

    def __init__(self, graph: Graph) -> None:
        """
        Initialize the edge state manager.

        Args:
            graph: The workflow graph
        """
        self.graph = graph
        self._lock = threading.RLock()

    def mark_edge_taken(self, edge_id: str) -> None:
        """
        Mark an edge as TAKEN.

        Args:
            edge_id: The ID of the edge to mark
        """
        with self._lock:
            self.graph.edges[edge_id].state = NodeState.TAKEN

    def mark_edge_skipped(self, edge_id: str) -> None:
        """
        Mark an edge as SKIPPED.

        Args:
            edge_id: The ID of the edge to mark
        """
        with self._lock:
            self.graph.edges[edge_id].state = NodeState.SKIPPED

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
            return self.graph.edges[edge_id].state

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
            outgoing_edges = self.graph.get_outgoing_edges(node_id)
            selected_edges: list[Edge] = []
            unselected_edges: list[Edge] = []

            for edge in outgoing_edges:
                if edge.source_handle == selected_handle:
                    selected_edges.append(edge)
                else:
                    unselected_edges.append(edge)

            return selected_edges, unselected_edges
