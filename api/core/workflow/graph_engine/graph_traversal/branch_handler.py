"""
Branch node handling for graph traversal.
"""

from collections.abc import Sequence
from typing import final

from core.workflow.graph import Graph
from core.workflow.graph_events.node import NodeRunStreamChunkEvent

from ..state_management import EdgeStateManager
from .edge_processor import EdgeProcessor
from .skip_propagator import SkipPropagator


@final
class BranchHandler:
    """
    Handles branch node logic during graph traversal.

    Branch nodes select one of multiple paths based on conditions,
    requiring special handling for edge selection and skip propagation.
    """

    def __init__(
        self,
        graph: Graph,
        edge_processor: EdgeProcessor,
        skip_propagator: SkipPropagator,
        edge_state_manager: EdgeStateManager,
    ) -> None:
        """
        Initialize the branch handler.

        Args:
            graph: The workflow graph
            edge_processor: Processor for edges
            skip_propagator: Propagator for skip states
            edge_state_manager: Manager for edge states
        """
        self.graph = graph
        self.edge_processor = edge_processor
        self.skip_propagator = skip_propagator
        self.edge_state_manager = edge_state_manager

    def handle_branch_completion(
        self, node_id: str, selected_handle: str | None
    ) -> tuple[Sequence[str], Sequence[NodeRunStreamChunkEvent]]:
        """
        Handle completion of a branch node.

        Args:
            node_id: The ID of the branch node
            selected_handle: The handle of the selected branch

        Returns:
            Tuple of (list of downstream nodes ready for execution, list of streaming events)

        Raises:
            ValueError: If no branch was selected
        """
        if not selected_handle:
            raise ValueError(f"Branch node {node_id} completed without selecting a branch")

        # Categorize edges into selected and unselected
        _, unselected_edges = self.edge_state_manager.categorize_branch_edges(node_id, selected_handle)

        # Skip all unselected paths
        self.skip_propagator.skip_branch_paths(unselected_edges)

        # Process selected edges and get ready nodes and streaming events
        return self.edge_processor.process_node_success(node_id, selected_handle)

    def validate_branch_selection(self, node_id: str, selected_handle: str) -> bool:
        """
        Validate that a branch selection is valid.

        Args:
            node_id: The ID of the branch node
            selected_handle: The handle to validate

        Returns:
            True if the selection is valid
        """
        outgoing_edges = self.graph.get_outgoing_edges(node_id)
        valid_handles = {edge.source_handle for edge in outgoing_edges}
        return selected_handle in valid_handles
