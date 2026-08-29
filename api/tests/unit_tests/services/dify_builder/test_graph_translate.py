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
    assert start.args["node_type"] == "start"
    assert "type" not in start.args["config"]
    assert start.args["config"]["title"] == "Start"


def test_to_intents_skips_malformed_nodes():
    from services.dify_builder.agent.graph_translate import to_intents
    graph = {"nodes": [{"id": "x", "data": {}}, {"id": "", "data": {"type": "llm"}}], "edges": []}
    assert to_intents(graph) == []  # no type / no id -> dropped


def test_to_intents_multiple_start_nodes_only_first_normalized():
    from services.dify_builder.agent.graph_translate import to_intents
    # Graph with two start-type nodes: only first should be renamed to "start", second keeps original id
    graph = {
        "nodes": [
            {"id": "s1", "type": "custom", "data": {"type": "start", "title": "Start 1"}},
            {"id": "s2", "type": "custom", "data": {"type": "start", "title": "Start 2"}},
            {"id": "n_llm", "type": "custom", "data": {"type": "llm", "title": "LLM"}},
        ],
        "edges": [
            {"id": "e1", "source": "s1", "target": "n_llm"},
            {"id": "e2", "source": "s2", "target": "n_llm"},
        ],
    }
    intents = to_intents(graph)

    # Extract node_ids from create_node intents
    create_node_ids = [i.args["node_id"] for i in intents if i.op == "create_node"]

    # Exactly one "start" and one "s2" (original id), plus "n_llm"
    assert "start" in create_node_ids, "First start node should be normalized to 'start'"
    assert "s2" in create_node_ids, "Second start node should keep original id 's2'"
    assert "n_llm" in create_node_ids, "LLM node should be present"

    # Count to ensure no duplicates
    assert create_node_ids.count("start") == 1, "Only one 'start' node_id should exist"
    assert len(create_node_ids) == 3, "Should have exactly 3 create_node intents"

    # Verify edges are remapped correctly
    connects = [i for i in intents if i.op == "connect"]
    assert len(connects) == 2, "Should have 2 connect intents"

    # First edge should connect from "start" (remapped s1) to "n_llm"
    assert connects[0].args["from_node"] == "start", "Edge from s1 should be remapped to 'start'"
    # Second edge should connect from "s2" (not remapped) to "n_llm"
    assert connects[1].args["from_node"] == "s2", "Edge from s2 should keep 's2'"


def test_to_intents_carries_branch_handles_through_connect():
    from services.dify_builder.agent.graph_translate import to_intents

    graph = {
        "nodes": [
            {"id": "if1", "type": "custom", "data": {"type": "if-else", "title": "If"}},
            {"id": "n_true", "type": "custom", "data": {"type": "llm", "title": "True branch"}},
        ],
        "edges": [
            {"id": "e1", "source": "if1", "target": "n_true", "sourceHandle": "true", "targetHandle": "target"},
        ],
    }
    intents = to_intents(graph)
    connect = next(i for i in intents if i.op == "connect")
    assert connect.args["source_handle"] == "true"
    assert connect.args["target_handle"] == "target"


def test_to_intents_connect_without_handles_has_no_handle_keys():
    from services.dify_builder.agent.graph_translate import to_intents

    graph = {
        "nodes": [
            {"id": "n1", "type": "custom", "data": {"type": "start", "title": "Start"}},
            {"id": "n2", "type": "custom", "data": {"type": "llm", "title": "LLM"}},
        ],
        "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
    }
    intents = to_intents(graph)
    connect = next(i for i in intents if i.op == "connect")
    assert connect.args == {"from_node": "start", "to_node": "n2"}
