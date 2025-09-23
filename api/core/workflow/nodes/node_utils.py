from typing import Any, Optional

from core.workflow.enums import NodeType


def get_node_type(node: Any) -> Optional[NodeType | str]:
    if not node or not hasattr(node, "get"):
        return None
    else:
        data = node.get("data")
        if not data:
            return None
        else:
            return data.get("type")


def is_node_type(node: Any, node_type: NodeType | str) -> bool:
    return get_node_type(node) == node_type
