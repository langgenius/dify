"""
Node readiness checking for execution.
"""

from typing import final

from core.workflow.enums import NodeState
from core.workflow.graph import Graph


@final
class NodeReadinessChecker:
    """
    Checks if nodes are ready for execution based on their dependencies.

    A node is ready when its dependencies (incoming edges) have been
    satisfied according to the graph's execution rules.
    """

    def __init__(self, graph: Graph) -> None:
        """
        Initialize the readiness checker.

        Args:
            graph: The workflow graph
        """
        self.graph = graph

    def is_node_ready(self, node_id: str) -> bool:
        """
        Check if a node is ready to be executed.

        A node is ready when:
        - It has no incoming edges (root or isolated node), OR
        - At least one incoming edge is TAKEN and none are UNKNOWN

        Args:
            node_id: The ID of the node to check

        Returns:
            True if the node is ready for execution
        """
        incoming_edges = self.graph.get_incoming_edges(node_id)

        # No dependencies means always ready
        if not incoming_edges:
            return True

        # Check edge states
        has_unknown = False
        has_taken = False

        for edge in incoming_edges:
            if edge.state == NodeState.UNKNOWN:
                has_unknown = True
                break
            elif edge.state == NodeState.TAKEN:
                has_taken = True

        # Not ready if any dependency is still unknown
        if has_unknown:
            return False

        # Ready if at least one path is taken
        return has_taken

    def get_ready_downstream_nodes(self, from_node_id: str) -> list[str]:
        """
        Get all downstream nodes that are ready after a node completes.

        Args:
            from_node_id: The ID of the completed node

        Returns:
            List of node IDs that are now ready
        """
        ready_nodes: list[str] = []
        outgoing_edges = self.graph.get_outgoing_edges(from_node_id)

        for edge in outgoing_edges:
            if edge.state == NodeState.TAKEN:
                downstream_node_id = edge.head
                if self.is_node_ready(downstream_node_id):
                    ready_nodes.append(downstream_node_id)

        return ready_nodes
