from typing import Any

from core.workflow.enums import NodeType


def get_node_type(node: Any) -> NodeType | str | None:
    if not node or not hasattr(node, "get"):
        return None
    else:
        data = node.get("data")
        return data.get("type") if data and hasattr(data, "get") else None


def match_node_type(node: Any, node_type: NodeType | str) -> bool:
    return get_node_type(node) == node_type
