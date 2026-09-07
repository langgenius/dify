"""Capture node labels alongside proposed and applied change summaries."""

from core.dify_builder.models import ChangedNode, Graph, MutationIntent


def describe_changed_nodes(node_ids: list[str], *graphs: Graph) -> list[ChangedNode]:
    """Keep node order, deduplicate identities, and prefer the newest graph's labels.

    Supplying both the before and after graph preserves names for deleted nodes.
    Nodes without a known name keep their ID for display.
    """
    titles = {
        node["id"]: node.get("data", {}).get("title", "")
        for graph in graphs
        for node in graph.get("nodes", [])
        if node.get("id")
    }
    return [ChangedNode(node_id=node_id, title=titles.get(node_id, "")) for node_id in dict.fromkeys(node_ids)]


def describe_proposed_nodes(intents: list[MutationIntent], graph: Graph) -> list[ChangedNode]:
    """Describe known node references, including both endpoints of connection edits."""
    node_ids: list[str] = []
    created_nodes = []
    for intent in intents:
        args = intent.args
        references = [args.get("node_id"), args.get("from_node"), args.get("to_node")]
        edge = args.get("edge")
        if isinstance(edge, dict):
            references.extend([edge.get("source"), edge.get("target")])
        node_ids.extend(node_id for node_id in references if isinstance(node_id, str) and node_id)
        if intent.op in {"create_node", "insert_between"} and isinstance(args.get("node_id"), str):
            created_nodes.append({"id": args["node_id"], "data": args.get("config", {})})
    return describe_changed_nodes(node_ids, graph, {"nodes": created_nodes})
