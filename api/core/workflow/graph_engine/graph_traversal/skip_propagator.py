"""
Skip state propagation through the graph.
"""

from collections.abc import Sequence
from typing import final

from core.workflow.graph import Edge, Graph

from ..graph_state_manager import GraphStateManager


@final
class SkipPropagator:
    """
    Propagates skip states through the graph.

    When a node is skipped, this ensures all downstream nodes
    that depend solely on it are also skipped.
    """

    def __init__(
        self,
        graph: Graph,
        state_manager: GraphStateManager,
    ) -> None:
        """
        Initialize the skip propagator.

        Args:
            graph: The workflow graph
            state_manager: Unified state manager
        """
        self._graph = graph
        self._state_manager = state_manager

    def propagate_skip_from_edge(self, edge_id: str) -> None:
        """
        Recursively propagate skip state from a skipped edge.

        Rules:
        - If a node has any UNKNOWN incoming edges, stop processing
        - If all incoming edges are SKIPPED, skip the node and its edges
        - If any incoming edge is TAKEN, the node may still execute

        Args:
            edge_id: The ID of the skipped edge to start from
        """
        downstream_node_id = self._graph.edges[edge_id].head
        incoming_edges = self._graph.get_incoming_edges(downstream_node_id)

        # Analyze edge states
        edge_states = self._state_manager.analyze_edge_states(incoming_edges)

        # Stop if there are unknown edges (not yet processed)
        if edge_states["has_unknown"]:
            return

        # If any edge is taken, node may still execute
        if edge_states["has_taken"]:
            # Enqueue node
            self._state_manager.enqueue_node(downstream_node_id)
            self._state_manager.start_execution(downstream_node_id)
            return

        # All edges are skipped, propagate skip to this node
        if edge_states["all_skipped"]:
            self._propagate_skip_to_node(downstream_node_id)

    def _propagate_skip_to_node(self, node_id: str) -> None:
        """
        Mark a node and all its outgoing edges as skipped.

        Args:
            node_id: The ID of the node to skip
        """
        # Mark node as skipped
        self._state_manager.mark_node_skipped(node_id)

        # Mark all outgoing edges as skipped and propagate
        outgoing_edges = self._graph.get_outgoing_edges(node_id)
        for edge in outgoing_edges:
            self._state_manager.mark_edge_skipped(edge.id)
            # Recursively propagate skip
            self.propagate_skip_from_edge(edge.id)

    def skip_branch_paths(self, unselected_edges: Sequence[Edge]) -> None:
        """
        Skip all paths from unselected branch edges.

        Args:
            unselected_edges: List of edges not taken by the branch
        """
        for edge in unselected_edges:
            self._state_manager.mark_edge_skipped(edge.id)
            self.propagate_skip_from_edge(edge.id)
