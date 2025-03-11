"""
Edge Generator
Used to generate edges in the workflow
"""

from core.auto.node_types.common import CommonEdgeType, CompleteEdge, CompleteNode
from core.auto.workflow_generator.models.workflow_description import ConnectionDescription


class EdgeGenerator:
    """Edge generator for creating workflow edges"""

    @staticmethod
    def create_edges(nodes: list[CompleteNode], connections: list[ConnectionDescription]) -> list[CompleteEdge]:
        """
        Create edges based on nodes and connection information

        Args:
            nodes: list of nodes
            connections: list of connection descriptions

        Returns:
            list of edges
        """
        edges = []

        # If connection information is provided, create edges based on it
        if connections:
            for connection in connections:
                source_id = connection.source
                target_id = connection.target

                if not source_id or not target_id:
                    continue

                # Find source and target nodes
                source_node = next((node for node in nodes if node.id == source_id), None)
                target_node = next((node for node in nodes if node.id == target_id), None)

                if not source_node or not target_node:
                    continue

                # Get node types
                source_type = source_node.data.type
                target_type = target_node.data.type

                # Create edge
                edge_id = f"{source_id}-source-{target_id}-target"

                # Create edge data
                edge_data = CommonEdgeType(isInIteration=False, sourceType=source_type, targetType=target_type)

                # Create complete edge
                edge = CompleteEdge(
                    id=edge_id,
                    source=source_id,
                    sourceHandle="source",
                    target=target_id,
                    targetHandle="target",
                    type="custom",
                    zIndex=0,
                )

                # Add edge data
                edge.add_data(edge_data)

                edges.append(edge)
        # If no connection information is provided, automatically create edges
        else:
            # Create edges based on node order
            for i in range(len(nodes) - 1):
                source_node = nodes[i]
                target_node = nodes[i + 1]

                # Get node types
                source_type = source_node.data.type
                target_type = target_node.data.type

                # Create edge
                edge_id = f"{source_node.id}-source-{target_node.id}-target"

                # Create edge data
                edge_data = CommonEdgeType(isInIteration=False, sourceType=source_type, targetType=target_type)

                # Create complete edge
                edge = CompleteEdge(
                    id=edge_id,
                    source=source_node.id,
                    sourceHandle="source",
                    target=target_node.id,
                    targetHandle="target",
                    type="custom",
                    zIndex=0,
                )

                # Add edge data
                edge.add_data(edge_data)

                edges.append(edge)

        return edges
