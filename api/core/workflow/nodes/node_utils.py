from typing import Any

from core.workflow.enums import NodeType


def get_node_field(node: Any, field_name: str) -> dict | None:
    return node.get(field_name) if node and hasattr(node, "get") else None


def get_node_type(node: Any) -> NodeType | str | None:
    data = get_node_field(node, field_name="data")
    return data.get("type") if data and hasattr(data, "get") else None


def match_node_type(node: Any, node_type: NodeType | str) -> bool:
    return get_node_type(node) == node_type
