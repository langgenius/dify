from collections.abc import Mapping

from core.workflow.enums import NodeType
from core.workflow.nodes.base.node import Node

LATEST_VERSION = "latest"

# Mapping is built by Node.get_node_type_classes_mapping(), which imports and walks core.workflow.nodes
NODE_TYPE_CLASSES_MAPPING: Mapping[NodeType, Mapping[str, type[Node]]] = Node.get_node_type_classes_mapping()
