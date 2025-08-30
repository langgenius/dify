"""
Edge processing logic for graph traversal.
"""

from collections.abc import Sequence
from typing import final

from core.workflow.enums import NodeExecutionType
from core.workflow.graph import Edge, Graph
from core.workflow.graph_events import NodeRunStreamChunkEvent

from ..response_coordinator import ResponseStreamCoordinator
from ..state_management import EdgeStateManager, NodeStateManager


@final
class EdgeProcessor:
    """
    Processes edges during graph execution.

    This handles marking edges as taken or skipped, notifying
    the response coordinator, and triggering downstream node execution.
    """

    def __init__(
        self,
        graph: Graph,
        edge_state_manager: EdgeStateManager,
        node_state_manager: NodeStateManager,
        response_coordinator: ResponseStreamCoordinator,
    ) -> None:
        """
        Initialize the edge processor.

        Args:
            graph: The workflow graph
            edge_state_manager: Manager for edge states
            node_state_manager: Manager for node states
            response_coordinator: Response stream coordinator
        """
        self.graph = graph
        self.edge_state_manager = edge_state_manager
        self.node_state_manager = node_state_manager
        self.response_coordinator = response_coordinator

    def process_node_success(
        self, node_id: str, selected_handle: str | None = None
    ) -> tuple[Sequence[str], Sequence[NodeRunStreamChunkEvent]]:
        """
        Process edges after a node succeeds.

        Args:
            node_id: The ID of the succeeded node
            selected_handle: For branch nodes, the selected edge handle

        Returns:
            Tuple of (list of downstream node IDs that are now ready, list of streaming events)
        """
        node = self.graph.nodes[node_id]

        if node.execution_type == NodeExecutionType.BRANCH:
            return self._process_branch_node_edges(node_id, selected_handle)
        else:
            return self._process_non_branch_node_edges(node_id)

    def _process_non_branch_node_edges(self, node_id: str) -> tuple[Sequence[str], Sequence[NodeRunStreamChunkEvent]]:
        """
        Process edges for non-branch nodes (mark all as TAKEN).

        Args:
            node_id: The ID of the succeeded node

        Returns:
            Tuple of (list of downstream nodes ready for execution, list of streaming events)
        """
        ready_nodes: list[str] = []
        all_streaming_events: list[NodeRunStreamChunkEvent] = []
        outgoing_edges = self.graph.get_outgoing_edges(node_id)

        for edge in outgoing_edges:
            nodes, events = self._process_taken_edge(edge)
            ready_nodes.extend(nodes)
            all_streaming_events.extend(events)

        return ready_nodes, all_streaming_events

    def _process_branch_node_edges(
        self, node_id: str, selected_handle: str | None
    ) -> tuple[Sequence[str], Sequence[NodeRunStreamChunkEvent]]:
        """
        Process edges for branch nodes.

        Args:
            node_id: The ID of the branch node
            selected_handle: The handle of the selected edge

        Returns:
            Tuple of (list of downstream nodes ready for execution, list of streaming events)

        Raises:
            ValueError: If no edge was selected
        """
        if not selected_handle:
            raise ValueError(f"Branch node {node_id} did not select any edge")

        ready_nodes: list[str] = []
        all_streaming_events: list[NodeRunStreamChunkEvent] = []

        # Categorize edges
        selected_edges, unselected_edges = self.edge_state_manager.categorize_branch_edges(node_id, selected_handle)

        # Process unselected edges first (mark as skipped)
        for edge in unselected_edges:
            self._process_skipped_edge(edge)

        # Process selected edges
        for edge in selected_edges:
            nodes, events = self._process_taken_edge(edge)
            ready_nodes.extend(nodes)
            all_streaming_events.extend(events)

        return ready_nodes, all_streaming_events

    def _process_taken_edge(self, edge: Edge) -> tuple[Sequence[str], Sequence[NodeRunStreamChunkEvent]]:
        """
        Mark edge as taken and check downstream node.

        Args:
            edge: The edge to process

        Returns:
            Tuple of (list containing downstream node ID if it's ready, list of streaming events)
        """
        # Mark edge as taken
        self.edge_state_manager.mark_edge_taken(edge.id)

        # Notify response coordinator and get streaming events
        streaming_events = self.response_coordinator.on_edge_taken(edge.id)

        # Check if downstream node is ready
        ready_nodes: list[str] = []
        if self.node_state_manager.is_node_ready(edge.head):
            ready_nodes.append(edge.head)

        return ready_nodes, streaming_events

    def _process_skipped_edge(self, edge: Edge) -> None:
        """
        Mark edge as skipped.

        Args:
            edge: The edge to skip
        """
        self.edge_state_manager.mark_edge_skipped(edge.id)
