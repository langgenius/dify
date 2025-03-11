"""
Layout Engine
Used to arrange the positions of nodes and edges
"""

from core.auto.node_types.common import CompleteEdge, CompleteNode


class LayoutEngine:
    """Layout engine"""

    @staticmethod
    def apply_layout(nodes: list[CompleteNode]) -> None:
        """
        Apply layout, arranging nodes in a row

        Args:
            nodes: list of nodes
        """
        # Simple linear layout, arranging nodes from left to right
        x_position = 80
        y_position = 282

        for node in nodes:
            node.position = {"x": x_position, "y": y_position}
            node.positionAbsolute = {"x": x_position, "y": y_position}

            # Update position for the next node
            x_position += 300  # Horizontal spacing between nodes

    @staticmethod
    def apply_topological_layout(nodes: list[CompleteNode], edges: list[CompleteEdge]) -> None:
        """
        Apply topological sort layout, arranging nodes based on their dependencies

        Args:
            nodes: list of nodes
            edges: list of edges
        """
        # Create mapping from node ID to node
        node_map = {node.id: node for node in nodes}

        # Create adjacency list
        adjacency_list = {node.id: [] for node in nodes}
        for edge in edges:
            adjacency_list[edge.source].append(edge.target)

        # Create in-degree table
        in_degree = {node.id: 0 for node in nodes}
        for source, targets in adjacency_list.items():
            for target in targets:
                in_degree[target] += 1

        # Topological sort
        queue = [node_id for node_id, degree in in_degree.items() if degree == 0]
        sorted_nodes = []

        while queue:
            current = queue.pop(0)
            sorted_nodes.append(current)

            for neighbor in adjacency_list[current]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        # Apply layout
        x_position = 80
        y_position = 282

        for node_id in sorted_nodes:
            node = node_map[node_id]
            node.position = {"x": x_position, "y": y_position}
            node.positionAbsolute = {"x": x_position, "y": y_position}

            # Update position for the next node
            x_position += 300  # Horizontal spacing between nodes
