from collections.abc import Mapping

from dify_graph.enums import NodeType
from dify_graph.nodes.base.node import Node

LATEST_VERSION = "latest"

# Mapping is built by Node.get_node_type_classes_mapping(), which imports and walks dify_graph.nodes
NODE_TYPE_CLASSES_MAPPING: Mapping[NodeType, Mapping[str, type[Node]]] = Node.get_node_type_classes_mapping()
