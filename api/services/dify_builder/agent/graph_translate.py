"""Translate a WorkflowGenerator graph into Dify Builder MutationIntents.

The generator emits ReactFlow nodes ({id, type:"custom", data:{type:<real>,...}})
and edges. We emit one create_node per node (config = node.data minus the
redundant "type" key -- apply_create_node re-sets it) followed by one connect
per edge, so every connect endpoint already exists at apply time. The start
node is renamed to the conventional id "start" so it reconciles with a draft
that already has one (the handler's present-filter drops the duplicate)."""

from typing import Any

from core.dify_builder.models import MutationIntent

_START_ID = "start"


def to_intents(graph: dict[str, Any]) -> list[MutationIntent]:
    nodes = graph.get("nodes") or []
    edges = graph.get("edges") or []

    # rename map: the generator start id -> canonical "start"
    # Only map the first start node; additional starts keep their original ids
    remap: dict[str, str] = {}
    for node in nodes:
        data = node.get("data") or {}
        if data.get("type") == "start" and node.get("id") and not remap:
            remap[str(node["id"])] = _START_ID

    creates: list[MutationIntent] = []
    for node in nodes:
        data = node.get("data") or {}
        node_type = data.get("type")
        node_id = node.get("id")
        if not node_type or not node_id:
            continue
        config = {k: v for k, v in data.items() if k != "type"}
        creates.append(MutationIntent(op="create_node", args={
            "node_type": str(node_type),
            "config": config,
            "node_id": remap.get(str(node_id), str(node_id)),
        }))

    connects: list[MutationIntent] = []
    for edge in edges:
        src, tgt = edge.get("source"), edge.get("target")
        if not src or not tgt:
            continue
        args: dict[str, Any] = {
            "from_node": remap.get(str(src), str(src)),
            "to_node": remap.get(str(tgt), str(tgt)),
        }
        source_handle = edge.get("sourceHandle")
        if source_handle:
            args["source_handle"] = source_handle
        target_handle = edge.get("targetHandle")
        if target_handle:
            args["target_handle"] = target_handle
        connects.append(MutationIntent(op="connect", args=args))

    return creates + connects
