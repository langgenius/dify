"""
Internal path representation for response coordinator.

This module contains the private Path class used internally by ResponseStreamCoordinator
to track execution paths to response nodes.
"""

from dataclasses import dataclass, field
from typing import TypeAlias

EdgeID: TypeAlias = str


@dataclass
class Path:
    """
    Represents a path of branch edges that must be taken to reach a response node.

    Note: This is an internal class not exposed in the public API.
    """

    edges: list[EdgeID] = field(default_factory=list[EdgeID])

    def contains_edge(self, edge_id: EdgeID) -> bool:
        """Check if this path contains the given edge."""
        return edge_id in self.edges

    def remove_edge(self, edge_id: EdgeID) -> None:
        """Remove the given edge from this path in place."""
        if self.contains_edge(edge_id):
            self.edges.remove(edge_id)

    def is_empty(self) -> bool:
        """Check if the path has no edges (node is reachable)."""
        return len(self.edges) == 0
