"""Recognize the unconfigured Chatflow template before replacing its nodes.

Canvas presentation is irrelevant. Model identity and empty memory role prefixes
can be filled by the editor without user configuration. Other configuration must
still match the initial template. Keep the frontend Builder classifier aligned.
"""

from core.dify_builder.models import Graph, MutationIntent


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


def build_intents_for_draft(graph: Graph, intents: list[MutationIntent], *, mode: str) -> list[MutationIntent]:
    """Replace initial placeholders; retain already-built nodes on reapproval.

    Delete and create stay in one apply_repair batch. Deleted IDs and their
    incident edges must not suppress generated intents that reuse those IDs.
    """
    nodes = graph.get("nodes", [])
    replace_initial = is_initial_chatflow(graph, mode=mode) or all(
        node.get("data", {}).get("type") == "start" for node in nodes
    )
    deletes = (
        [MutationIntent(op="delete_node", args={"node_id": node["id"]}) for node in nodes] if replace_initial else []
    )
    deleted_ids = {intent.args["node_id"] for intent in deletes}
    existing_ids = {node["id"] for node in nodes} - deleted_ids
    existing_edges = {
        (edge.get("source"), edge.get("target"))
        for edge in graph.get("edges", [])
        if edge.get("source") not in deleted_ids and edge.get("target") not in deleted_ids
    }
    return deletes + [
        intent
        for intent in intents
        if not (
            (intent.op == "create_node" and intent.args.get("node_id") in existing_ids)
            or (intent.op == "connect" and (intent.args.get("from_node"), intent.args.get("to_node")) in existing_edges)
        )
    ]
