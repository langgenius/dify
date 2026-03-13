from __future__ import annotations

from collections.abc import Mapping
from importlib import import_module

from dify_graph.enums import NodeType
from dify_graph.nodes.base.node import Node
from dify_graph.nodes.node_mapping import LATEST_VERSION, get_node_type_classes_mapping

_WORKFLOW_NODE_MODULES = ("core.workflow.nodes.agent",)
_workflow_nodes_registered = False


def ensure_workflow_nodes_registered() -> None:
    """Import workflow-local node modules so they can register with `Node.__init_subclass__`."""
    global _workflow_nodes_registered

    if _workflow_nodes_registered:
        return

    for module_name in _WORKFLOW_NODE_MODULES:
        import_module(module_name)

    _workflow_nodes_registered = True


def get_workflow_node_type_classes_mapping() -> Mapping[NodeType, Mapping[str, type[Node]]]:
    ensure_workflow_nodes_registered()
    return get_node_type_classes_mapping()


def resolve_workflow_node_class(*, node_type: NodeType, node_version: str) -> type[Node]:
    node_mapping = get_workflow_node_type_classes_mapping().get(node_type)
    if not node_mapping:
        raise ValueError(f"No class mapping found for node type: {node_type}")

    latest_node_class = node_mapping.get(LATEST_VERSION)
    matched_node_class = node_mapping.get(node_version)
    node_class = matched_node_class or latest_node_class
    if not node_class:
        raise ValueError(f"No latest version class found for node type: {node_type}")
    return node_class
