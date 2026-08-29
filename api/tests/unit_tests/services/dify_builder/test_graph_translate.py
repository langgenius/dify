def test_to_intents_translates_nodes_then_edges_and_normalizes_start():
    from services.dify_builder.agent.graph_translate import to_intents

    graph = {
        "nodes": [
            {"id": "n_start", "type": "custom", "position": {"x": 0, "y": 0},
             "data": {"type": "start", "title": "Start", "variables": []}},
            {"id": "n_llm", "type": "custom", "position": {"x": 1, "y": 0},
             "data": {"type": "llm", "title": "LLM", "model": {"provider": "", "name": ""}}},
        ],
        "edges": [{"id": "e1", "source": "n_start", "target": "n_llm", "type": "custom"}],
    }
    intents = to_intents(graph)
    ops = [(i.op, i.args.get("node_id") or (i.args.get("from_node"), i.args.get("to_node"))) for i in intents]
    assert ops == [("create_node", "start"), ("create_node", "n_llm"), ("connect", ("start", "n_llm"))]
    # config carries data minus the type key; create_node args expose node_type
    start = intents[0]
    assert start.args["node_type"] == "start" and "type" not in start.args["config"]
    assert start.args["config"]["title"] == "Start"

def test_to_intents_skips_malformed_nodes():
    from services.dify_builder.agent.graph_translate import to_intents
    graph = {"nodes": [{"id": "x", "data": {}}, {"id": "", "data": {"type": "llm"}}], "edges": []}
    assert to_intents(graph) == []  # no type / no id -> dropped
