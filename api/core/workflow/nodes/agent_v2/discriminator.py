from collections.abc import Mapping
from typing import Any

from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes

AGENT_NODE_KIND = "dify_agent"
AGENT_NODE_VERSION = "2"


def is_dify_agent_node_data(node_data: Mapping[str, Any] | BaseNodeData) -> bool:
    """Return whether node data explicitly identifies the new Dify Agent node."""

    if isinstance(node_data, Mapping):
        node_type = node_data.get("type")
        node_version = node_data.get("version")
        agent_node_kind = node_data.get("agent_node_kind")
    else:
        serialized_node_data = node_data.model_dump(mode="python")
        node_type = serialized_node_data.get("type")
        node_version = serialized_node_data.get("version")
        agent_node_kind = serialized_node_data.get("agent_node_kind")

    return (
        node_type == BuiltinNodeTypes.AGENT
        and str(node_version) == AGENT_NODE_VERSION
        and agent_node_kind == AGENT_NODE_KIND
    )
