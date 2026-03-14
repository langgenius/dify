from collections.abc import Mapping

from dify_graph.enums import NodeType
from dify_graph.nodes.base.node import Node

LATEST_VERSION = "latest"


def get_node_type_classes_mapping() -> Mapping[NodeType, Mapping[str, type[Node]]]:
    """Return the live node registry after importing all `dify_graph.nodes` modules."""
    return Node.get_node_type_classes_mapping()


def resolve_node_class(*, node_type: NodeType, node_version: str) -> type[Node]:
    node_mapping = get_node_type_classes_mapping().get(node_type)
    if not node_mapping:
        raise ValueError(f"No class mapping found for node type: {node_type}")

    latest_node_class = node_mapping.get(LATEST_VERSION)
    matched_node_class = node_mapping.get(node_version)
    node_class = matched_node_class or latest_node_class
    if not node_class:
        raise ValueError(f"No latest version class found for node type: {node_type}")
    return node_class


# Snapshot kept for compatibility with older tests; production paths should use the live helpers.
NODE_TYPE_CLASSES_MAPPING: Mapping[NodeType, Mapping[str, type[Node]]] = get_node_type_classes_mapping()
