"""Graph restrictions shared by snippet editing, publication and import."""

from collections.abc import Mapping
from typing import Any

from graphon.enums import BuiltinNodeTypes

# Node types not allowed in snippet workflows (sync, publish, DSL import).
SNIPPET_FORBIDDEN_NODE_TYPES: frozenset[str] = frozenset(
    {
        BuiltinNodeTypes.START,
        BuiltinNodeTypes.HUMAN_INPUT,
        BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
    }
)


def validate_snippet_graph_forbidden_nodes(graph: Mapping[str, Any]) -> None:
    """Reject graphs that contain node types not allowed in snippets."""
    nodes = graph.get("nodes") or []
    disallowed: list[tuple[str, str]] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_data = node.get("data") or {}
        node_type = node_data.get("type")
        if not isinstance(node_type, str):
            continue
        if node_type in SNIPPET_FORBIDDEN_NODE_TYPES:
            node_id = node.get("id")
            disallowed.append((str(node_id) if node_id is not None else "?", node_type))
    if not disallowed:
        return
    detail = ", ".join(f"{nid}:{t}" for nid, t in disallowed)
    raise ValueError(
        f"Snippet workflow cannot contain start, human-input, or knowledge-retrieval nodes. Found: {detail}"
    )
