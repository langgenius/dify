"""Pure, client-side graph mutation helpers.

Dify's ``sync_draft_workflow`` has no server-side patch primitive: it always
replaces the whole draft graph. The adapter (``dify_port.py``) therefore
reads the current graph, applies mutations like ``apply_set_node_config``
locally, and writes the whole mutated graph back. These helpers do the local
mutation only — no DB, no services, no I/O.
"""

import copy
from typing import Any

from core.workflow_copilot.models import Graph, MutationIntent

MUTATION_ARG_KEYS: dict[str, tuple[str, ...]] = {
    "set_node_config": ("node_id", "path", "value"),
    "create_node": ("node_type", "config"),
    "delete_node": ("node_id",),
    "connect": ("from_node", "to_node"),
    "insert_between": ("edge", "node_type", "config"),
}


def validate_intent_args(intent: MutationIntent) -> None:
    """Raise ``ValueError`` if ``intent.args`` is missing a required key for
    ``intent.op``, or if ``intent.op`` isn't one of ``MUTATION_ARG_KEYS``'s
    five recognized verbs. Optional keys (marked ``?`` on ``MutationIntent``)
    are not checked here -- each ``apply_*`` function defaults them itself.
    """
    required = MUTATION_ARG_KEYS.get(intent.op)
    if required is None:
        raise ValueError(f"unknown mutation op: {intent.op!r}")
    missing = [key for key in required if key not in intent.args]
    if missing:
        raise ValueError(f"missing required arg(s) {missing} for op {intent.op!r}")


def apply_set_node_config(graph: Graph, node_id: str, path: str, value: Any) -> tuple[Graph, list[str]]:
    """Set ``node["data"][path] = value`` for the node whose ``id == node_id``.

    The placeholder agent emits intents shaped ``{node_id, path, value}``
    (e.g. ``path="code"`` to rewrite a Code node's ``data["code"]``); this is
    the mutation that consumes them.

    Returns a ``(new_graph, changed_node_ids)`` tuple. ``graph`` is
    deep-copied first and never mutated. Raises ``ValueError`` if no node in
    ``graph["nodes"]`` has a matching ``id``.
    """
    new_graph = copy.deepcopy(graph)

    for node in new_graph.get("nodes", []):
        if node.get("id") == node_id:
            node.setdefault("data", {})[path] = value
            return new_graph, [node_id]

    raise ValueError(f"node not found: {node_id}")


def _next_node_id(prefix: str, existing_ids: set) -> str:
    """Return a short, human-readable node id not present in ``existing_ids``.

    Mirrors ``core.workflow.generator.runner._next_generated_node_id``'s
    prefix, then prefix_2, prefix_3, ... collision scheme -- reimplemented
    locally so this module stays free of any dependency on the generator
    subsystem.
    """
    candidate = prefix
    suffix = 1
    while candidate in existing_ids:
        suffix += 1
        candidate = f"{prefix}_{suffix}"
    return candidate


def _default_position(graph: Graph) -> dict[str, float]:
    """Place a new node to the right of the rightmost existing node.

    Slice 1 uses simple deterministic rightward placement, not the
    generator's topology-aware layout (``_layout_top_level_nodes``) --
    good enough for one node at a time; a smarter layout is Slice 2/3's
    concern if the canvas ever needs it.
    """
    nodes = graph.get("nodes", [])
    if not nodes:
        return {"x": 100.0, "y": 100.0}
    max_x = max(float(n.get("position", {}).get("x", 0.0)) for n in nodes)
    return {"x": max_x + 260.0, "y": 100.0}


def _build_node(
    graph: Graph,
    node_type: str,
    config: dict[str, Any],
    position: dict[str, float] | None,
    node_id: str | None,
) -> dict[str, Any]:
    """Construct one ``GraphNodeDict``-shaped node, generating an id/position
    when omitted (mirrors the generator's ``_fill_node_defaults``,
    ``core/workflow/generator/runner.py:2387-2394``). Raises ``ValueError``
    if a caller-supplied ``node_id`` already exists in ``graph["nodes"]``.
    """
    existing_ids = {n.get("id") for n in graph.get("nodes", [])}
    if node_id is not None:
        if node_id in existing_ids:
            raise ValueError(f"node id already exists: {node_id}")
        new_id = node_id
    else:
        new_id = _next_node_id(node_type, existing_ids)

    data = copy.deepcopy(config)
    data["type"] = node_type  # data.type is the real node type -- never overridden by config
    data.setdefault("title", new_id)
    data.setdefault("desc", "")
    data.setdefault("selected", False)

    return {
        "id": new_id,
        "type": "custom",
        "position": position if position is not None else _default_position(graph),
        "data": data,
    }


def apply_create_node(
    graph: Graph,
    node_type: str,
    config: dict[str, Any],
    position: dict[str, float] | None = None,
    node_id: str | None = None,
) -> tuple[Graph, list[str]]:
    """Append a new ``GraphNodeDict``-shaped node to the graph.

    ``node_id`` is optional (not part of spec Sec 9's terse args list) --
    when omitted a short id is generated from ``node_type``; when supplied,
    a collision with an existing node id raises ``ValueError`` (the Slice 1
    duplicate-id validation). Returns ``(new_graph, [new_node_id])``.
    """
    new_graph = copy.deepcopy(graph)
    node = _build_node(new_graph, node_type, config, position, node_id)
    new_graph.setdefault("nodes", []).append(node)
    return new_graph, [node["id"]]


def apply_delete_node(graph: Graph, node_id: str) -> tuple[Graph, list[str]]:
    """Remove the node with ``id == node_id`` and every edge touching it.

    Raises ``ValueError`` if no node in ``graph["nodes"]`` has a matching
    ``id`` (mirrors ``apply_set_node_config``'s not-found behavior).
    Returns ``(new_graph, [node_id])``.
    """
    new_graph = copy.deepcopy(graph)
    nodes = new_graph.get("nodes", [])
    if not any(n.get("id") == node_id for n in nodes):
        raise ValueError(f"node not found: {node_id}")

    new_graph["nodes"] = [n for n in nodes if n.get("id") != node_id]
    new_graph["edges"] = [
        e for e in new_graph.get("edges", [])
        if e.get("source") != node_id and e.get("target") != node_id
    ]
    return new_graph, [node_id]


def _next_edge_id(source: str, target: str, existing_ids: set) -> str:
    """Return a short edge id (``source-target``, then ``source-target_2``,
    ... on collision) not present in ``existing_ids``."""
    candidate = f"{source}-{target}"
    suffix = 1
    while candidate in existing_ids:
        suffix += 1
        candidate = f"{source}-{target}_{suffix}"
    return candidate


def apply_connect(
    graph: Graph,
    from_node: str,
    to_node: str,
    source_handle: str | None = None,
    target_handle: str | None = None,
) -> tuple[Graph, list[str]]:
    """Add a ``GraphEdgeDict``-shaped edge between two existing nodes.

    Raises ``ValueError`` if either ``from_node`` or ``to_node`` is not a
    node id present in ``graph["nodes"]`` (the Slice 1 dangling-ref
    validation). Handles default to "source"/"target" (mirrors the
    generator's ``_fill_edge_defaults``). Returns
    ``(new_graph, [from_node, to_node])``.
    """
    new_graph = copy.deepcopy(graph)
    node_ids = {n.get("id") for n in new_graph.get("nodes", [])}
    if from_node not in node_ids:
        raise ValueError(f"node not found: {from_node}")
    if to_node not in node_ids:
        raise ValueError(f"node not found: {to_node}")

    existing_edge_ids = {e.get("id") for e in new_graph.get("edges", [])}
    edge = {
        "id": _next_edge_id(from_node, to_node, existing_edge_ids),
        "source": from_node,
        "target": to_node,
        "type": "custom",
        "sourceHandle": source_handle or "source",
        "targetHandle": target_handle or "target",
    }
    new_graph.setdefault("edges", []).append(edge)
    return new_graph, [from_node, to_node]


def apply_insert_between(
    graph: Graph,
    edge: dict[str, str],
    node_type: str,
    config: dict[str, Any],
    position: dict[str, float] | None = None,
    node_id: str | None = None,
) -> tuple[Graph, list[str]]:
    """Split an existing edge with a new node: remove the old edge, add
    ``old_source -> new_node`` and ``new_node -> old_target``.

    ``edge`` identifies the edge to split by ``{"source": ..., "target": ...}``
    (matching Dify's own edge fields, not a caller-known internal edge id).
    Raises ``ValueError`` if no edge in ``graph["edges"]`` matches (the
    Slice 1 dangling-ref validation). Returns ``(new_graph, [new_node_id])``.
    """
    old_source = edge.get("source")
    old_target = edge.get("target")
    new_graph = copy.deepcopy(graph)
    edges = new_graph.get("edges", [])
    matched = next(
        (e for e in edges if e.get("source") == old_source and e.get("target") == old_target), None
    )
    if matched is None:
        raise ValueError(f"edge not found: {old_source} -> {old_target}")

    node = _build_node(new_graph, node_type, config, position, node_id)
    new_id = node["id"]
    new_graph.setdefault("nodes", []).append(node)

    remaining_edges = [e for e in edges if e is not matched]
    existing_edge_ids = {e.get("id") for e in remaining_edges}
    incoming = {
        "id": _next_edge_id(old_source, new_id, existing_edge_ids),
        "source": old_source,
        "target": new_id,
        "type": "custom",
        "sourceHandle": matched.get("sourceHandle") or "source",
        "targetHandle": "target",
    }
    existing_edge_ids.add(incoming["id"])
    outgoing = {
        "id": _next_edge_id(new_id, old_target, existing_edge_ids),
        "source": new_id,
        "target": old_target,
        "type": "custom",
        "sourceHandle": "source",
        "targetHandle": matched.get("targetHandle") or "target",
    }
    new_graph["edges"] = [*remaining_edges, incoming, outgoing]
    return new_graph, [new_id]
