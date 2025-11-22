from collections.abc import Mapping

# Import the package once to trigger metaclass auto-registration via __init__ side effects
import core.workflow.nodes as _  # noqa: F401
from core.workflow.enums import NodeType
from core.workflow.nodes.base.node import Node

LATEST_VERSION = "latest"

# Auto-generated mapping via metaclass registry
NODE_TYPE_CLASSES_MAPPING: Mapping[NodeType, Mapping[str, type[Node]]] = Node.get_node_type_classes_mapping()
