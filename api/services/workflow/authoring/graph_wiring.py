"""Add what the console editor adds to a skeleton graph: node wrappers, titles, edge handles, ids and layout."""

from collections.abc import Mapping
from typing import Any, Final, TypeGuard

from core.workflow.editor_graph import (
    EDITOR_CUSTOM_TYPE,
    editor_edge_data,
    editor_edge_id,
    editor_node_wrapper,
    layout_top_level_nodes,
)
from services.workflow_variable_reference_validator import SOURCE_HANDLE, branch_handles

TARGET_HANDLE: Final = "target"
_EDGE_ID_KEYS: Final = ("source", "sourceHandle", "target", "targetHandle")


def fill_graph_wiring(graph: dict[str, Any]) -> None:
    """Fill the graph in place; anything it cannot read is left exactly as written."""
    nodes = [node for node in _items(graph, "nodes") if _is_readable_node(node)]
    edges = [edge for edge in _items(graph, "edges") if _is_readable_edge(edge)]
    editable = [node for node in nodes if _is_editable(node)]

    needs_layout = all(node.get("position") is None for node in editable)
    for node in editable:
        editor_node_wrapper(node, position=None)
        _fill_title(node)
    if needs_layout:
        layout_top_level_nodes(nodes=editable, edges=edges)

    nodes_by_id = {node["id"]: node for node in nodes if isinstance(node.get("id"), str)}
    for edge in edges:
        _fill_edge(edge, nodes_by_id=nodes_by_id)


def _items(graph: Mapping[str, Any], key: str) -> list[Any]:
    items = graph.get(key)
    return items if isinstance(items, list) else []


def _is_readable_node(node: object) -> TypeGuard[dict[str, Any]]:
    if not isinstance(node, dict):
        return False
    if not isinstance(node.get("data"), dict):
        return False
    return isinstance(node.get("parentId"), str | None)


def _is_readable_edge(edge: object) -> TypeGuard[dict[str, Any]]:
    if not isinstance(edge, dict):
        return False
    if not isinstance(edge.get("data", {}), dict):
        return False
    return all(isinstance(edge.get(key, ""), str) for key in ("source", "target"))


def _is_editable(node: Mapping[str, Any]) -> bool:
    if node.get("parentId"):
        return False
    return node.get("type", EDITOR_CUSTOM_TYPE) == EDITOR_CUSTOM_TYPE


def _fill_title(node: Mapping[str, Any]) -> None:
    data = node["data"]
    node_type = data.get("type")
    if isinstance(node_type, str):
        data.setdefault("title", node_type)


def _fill_edge(edge: dict[str, Any], *, nodes_by_id: Mapping[str, Mapping[str, Any]]) -> None:
    source = nodes_by_id.get(edge.get("source", ""))
    if source is not None:
        _fill_source_handle(edge, source["data"])
    edge.setdefault("targetHandle", TARGET_HANDLE)
    if _has_id_parts(edge):
        edge.setdefault("id", editor_edge_id(edge))
    editor_edge_data(edge, nodes_by_id=nodes_by_id)


def _fill_source_handle(edge: dict[str, Any], source_data: Mapping[str, Any]) -> None:
    handles = branch_handles(source_data)
    if handles is None or SOURCE_HANDLE in handles:
        edge.setdefault("sourceHandle", SOURCE_HANDLE)


def _has_id_parts(edge: Mapping[str, Any]) -> bool:
    return all(key in edge for key in _EDGE_ID_KEYS)
