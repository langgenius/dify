"""Translate a WorkflowGenerator graph into Dify Builder MutationIntents.

The generator emits ReactFlow nodes ({id, type:"custom", data:{type:<real>,...}})
and edges. We emit one create_node per node (config = node.data minus the
redundant "type" key -- apply_create_node re-sets it) followed by one connect
per edge, so every connect endpoint already exists at apply time. Node ids
are preserved verbatim -- including the generator's start node id -- so
intra-node references (variable selectors, prompt {{#id.var#}}) stay valid;
reconciling the generator's start node with the draft's existing start is the
handler's job, not this translation step."""

from typing import Any

from core.dify_builder.models import MutationIntent

# Container-start markers the frontend synthesizes for iteration/loop bodies.
# The generator emits them correctly typed, but a Builder create_node re-creates
# them as generic `custom` nodes with no matching component, which crashes the
# canvas on open and never recovers (ESQ1-288). The canvas rebuilds them from
# the container itself, so dropping them here loses nothing.
_SYNTHETIC_NODE_TYPES = frozenset({"iteration-start", "loop-start"})

# The frontend regenerates container start markers at render time and
# rewrites start_node_id to the marker it created (workflow-init.ts:124-141,
# :177-181). Persisting our own pointer leaves it dangling once the marker
# node is skipped, and workflow-init.ts:147 dereferences it without a guard.
_FRONTEND_OWNED_KEYS = frozenset({"start_node_id"})


def to_intents(graph: dict[str, Any]) -> list[MutationIntent]:
    nodes = graph.get("nodes") or []
    edges = graph.get("edges") or []

    creates: list[MutationIntent] = []
    skipped_node_ids: set[str] = set()
    for node in nodes:
        data = node.get("data") or {}
        node_type = data.get("type")
        if node_type in _SYNTHETIC_NODE_TYPES:
            skipped_node_ids.add(node.get("id"))
            continue
        node_id = node.get("id")
        if not node_type or not node_id:
            continue
        config = {k: v for k, v in data.items() if k != "type" and k not in _FRONTEND_OWNED_KEYS}
        args: dict[str, Any] = {
            "node_type": str(node_type),
            "config": config,
            "node_id": str(node_id),
        }
        # The ReactFlow wrapper carries nesting and layout OUTSIDE `data`, so
        # reading only id+data dropped them on every build: children landed
        # un-nested and the generator's layout was replaced by defaults.
        parent_id = node.get("parentId")
        if parent_id:
            args["parent_id"] = str(parent_id)
        position = node.get("position")
        if isinstance(position, dict):
            args["position"] = dict(position)
        creates.append(MutationIntent(op="create_node", args=args))

    connects: list[MutationIntent] = []
    for edge in edges:
        src, tgt = edge.get("source"), edge.get("target")
        if not src or not tgt:
            continue
        if src in skipped_node_ids or tgt in skipped_node_ids:
            continue
        args: dict[str, Any] = {"from_node": str(src), "to_node": str(tgt)}
        source_handle = edge.get("sourceHandle")
        if source_handle:
            args["source_handle"] = source_handle
        target_handle = edge.get("targetHandle")
        if target_handle:
            args["target_handle"] = target_handle
        connects.append(MutationIntent(op="connect", args=args))

    return creates + connects
