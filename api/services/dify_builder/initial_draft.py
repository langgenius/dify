"""Reconcile approved generation with placeholders and session-owned nodes.

Canvas presentation is irrelevant. Model identity and empty memory role prefixes
can be filled by the editor without user configuration. Other configuration must
still match the initial template. Keep the frontend Builder classifier aligned.
"""

from collections.abc import Collection

from core.dify_builder.models import Graph, MutationIntent
from services.dify_builder.graph_ops import apply_create_node, validate_intent_args


def _initial_data(data: dict) -> dict:
    return {
        key: value
        for key, value in data.items()
        if not key.startswith("_") and key not in {"title", "selected"} and not (key == "desc" and not value)
    }


def is_initial_chatflow(graph: Graph, *, mode: str) -> bool:
    nodes, edges = graph.get("nodes", []), graph.get("edges", [])
    if mode != "advanced-chat" or len(nodes) != 3 or len(edges) != 2 or any(n.get("parentId") for n in nodes):
        return False
    by_type = {node.get("data", {}).get("type"): node for node in nodes}
    if set(by_type) != {"start", "llm", "answer"}:
        return False
    start, llm, answer = (by_type[kind] for kind in ("start", "llm", "answer"))
    if not all(node.get("id") for node in (start, llm, answer)):
        return False
    for source, target in ((start["id"], llm["id"]), (llm["id"], answer["id"])):
        if not any(
            edge.get("source") == source
            and edge.get("target") == target
            and edge.get("sourceHandle") in (None, "", "source")
            and edge.get("targetHandle") in (None, "", "target")
            for edge in edges
        ):
            return False
    llm_data = _initial_data(llm["data"])
    model, memory = llm_data.get("model"), llm_data.get("memory")
    if not isinstance(model, dict) or not isinstance(memory, dict):
        return False
    llm_data["model"] = {key: value for key, value in model.items() if key not in {"provider", "name"}}
    llm_data["memory"] = {
        key: value for key, value in memory.items() if key != "role_prefix" or value != {"user": "", "assistant": ""}
    }
    return (
        _initial_data(start["data"]) == {"type": "start", "variables": []}
        and _initial_data(answer["data"])
        == {"type": "answer", "variables": [], "answer": f"{{{{#{llm['id']}.text#}}}}"}
        and llm_data
        == {
            "type": "llm",
            "model": {"mode": "chat", "completion_params": {"temperature": 0.7}},
            "prompt_template": [{"role": "system", "text": ""}],
            "context": {"enabled": False, "variable_selector": []},
            "vision": {"enabled": False},
            "memory": {
                "window": {"enabled": False, "size": 10},
                "query_prompt_template": "{{#sys.query#}}\n\n{{#sys.files#}}",
            },
        }
    )


def _owned_config_intents(node: dict, intent: MutationIntent) -> list[MutationIntent]:
    """Convert one owned same-type create into changed configuration paths.

    The caller establishes ownership. Type, containment and ReactFlow component
    must match; unsupported replacements raise ValueError before any write.
    Reuse creation's defaults for explicitly generated fields, retaining all
    unmentioned data and canvas presentation. Neither input is mutated.
    """
    validate_intent_args(intent)
    node_id, node_type = node["id"], intent.args["node_type"]
    data = node.get("data", {})
    if node_type != data.get("type"):
        raise ValueError(f"Node {node_id!r} changes type; adjust the plan to keep its existing type before approving.")
    if (intent.args.get("parent_id") or None) != (node.get("parentId") or None):
        raise ValueError(f"Node {node_id!r} changes container; adjust the plan to keep its existing container.")
    if intent.args.get("flow_type") and intent.args["flow_type"] != node.get("type", "custom"):
        raise ValueError(f"Node {node_id!r} changes canvas component; adjust the plan to keep its existing component.")
    replacement, _ = apply_create_node(
        {"nodes": [], "edges": []},
        node_type,
        intent.args["config"],
        node_id=node_id,
        parent_id=intent.args.get("parent_id"),
        flow_type=intent.args.get("flow_type"),
    )
    generated = replacement["nodes"][0]
    if generated["type"] != node.get("type", "custom"):
        raise ValueError(f"Node {node_id!r} changes canvas component; adjust the plan to keep its existing component.")
    patches = []
    for key in intent.args["config"]:
        if key in {"isInIteration", "iteration_id", "isInLoop", "loop_id"} and generated["data"][key] != data.get(key):
            raise ValueError(f"Node {node_id!r} changes containment configuration; keep its existing container.")
        if key not in {"type", "title", "desc", "selected", "width", "height"} and not key.startswith("_"):
            if "." in key or key.isdigit():
                raise ValueError(f"Node {node_id!r} has an unsupported configuration field {key!r}.")
            value = generated["data"][key]
            if key not in data or data[key] != value:
                patches.append(
                    MutationIntent(op="set_node_config", args={"node_id": node_id, "path": key, "value": value})
                )
    return patches


def build_intents_for_draft(
    graph: Graph, intents: list[MutationIntent], *, mode: str, built_node_ids: Collection[str]
) -> list[MutationIntent]:
    """Replace placeholders or update explicitly generated owned configuration.

    Delete and create stay in one apply_repair batch. Deleted IDs and their
    incident edges must not suppress generated intents that reuse those IDs.
    Existing IDs require session ownership and same-type/containment creates;
    otherwise raise ValueError without mutating the graph or input intents.
    Identical owned configuration and existing connections produce no intents.
    """
    nodes = graph.get("nodes", [])
    replace_initial = is_initial_chatflow(graph, mode=mode) or all(
        node.get("data", {}).get("type") == "start" for node in nodes
    )
    deletes = (
        [MutationIntent(op="delete_node", args={"node_id": node["id"]}) for node in nodes] if replace_initial else []
    )
    deleted_ids = {intent.args["node_id"] for intent in deletes}
    existing = {node["id"]: node for node in nodes if node["id"] not in deleted_ids}
    existing_edges = {
        (edge.get("source"), edge.get("target"))
        for edge in graph.get("edges", [])
        if edge.get("source") not in deleted_ids and edge.get("target") not in deleted_ids
    }
    reconciled = list(deletes)
    for intent in intents:
        node_id = intent.args.get("node_id")
        if intent.op == "create_node" and node_id in existing:
            if node_id not in built_node_ids:
                raise ValueError(
                    f"Node {node_id!r} already exists and was not built by this session. "
                    "Adjust the plan to use distinct node IDs before approving."
                )
            reconciled.extend(_owned_config_intents(existing[node_id], intent))
        elif not (
            intent.op == "connect" and (intent.args.get("from_node"), intent.args.get("to_node")) in existing_edges
        ):
            reconciled.append(intent)
    return reconciled
