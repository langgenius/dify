def test_to_intents_translates_nodes_then_edges_preserving_ids():
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
    assert ops == [("create_node", "n_start"), ("create_node", "n_llm"), ("connect", ("n_start", "n_llm"))]
    # config carries data minus the type key; create_node args expose node_type
    start = intents[0]
    assert start.args["node_type"] == "start"
    assert "type" not in start.args["config"]
    assert start.args["config"]["title"] == "Start"


def test_to_intents_preserves_original_start_id_and_references():
    from services.dify_builder.agent.graph_translate import to_intents
    graph = {
        "nodes": [
            {"id": "node1", "type": "custom", "data": {"type": "start", "title": "Start",
                "variables": [{"variable": "document", "type": "file", "required": True}]}},
            {"id": "node2", "type": "custom", "data": {"type": "document-extractor", "title": "Extract",
                "variable_selector": ["node1", "document"]}},
        ],
        "edges": [{"id": "e1", "source": "node1", "target": "node2", "type": "custom"}],
    }
    intents = to_intents(graph)
    creates = {i.args["node_id"]: i for i in intents if i.op == "create_node"}
    # start keeps its original id -> the document-extractor's selector stays valid
    assert "node1" in creates
    assert "start" not in creates
    assert creates["node1"].args["node_type"] == "start"
    assert creates["node2"].args["config"]["variable_selector"] == ["node1", "document"]
    connect = next(i for i in intents if i.op == "connect")
    assert connect.args["from_node"] == "node1"
    assert connect.args["to_node"] == "node2"


def test_to_intents_skips_malformed_nodes():
    from services.dify_builder.agent.graph_translate import to_intents
    graph = {"nodes": [{"id": "x", "data": {}}, {"id": "", "data": {"type": "llm"}}], "edges": []}
    assert to_intents(graph) == []  # no type / no id -> dropped


def test_to_intents_preserves_ids_and_order_for_multiple_nodes():
    from services.dify_builder.agent.graph_translate import to_intents
    # Graph with two start-type nodes: neither is renamed, and creates/connects
    # are emitted in the generator's original node/edge order.
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

    # Both original ids are preserved, in node order, and "start" is never synthesized
    assert create_node_ids == ["s1", "s2", "n_llm"], "Original ids should be preserved in node order"
    assert "start" not in create_node_ids, "No node should be renamed to the synthetic 'start' id"

    # Verify edges keep their original endpoints, in edge order
    connects = [i for i in intents if i.op == "connect"]
    assert len(connects) == 2, "Should have 2 connect intents"

    assert connects[0].args["from_node"] == "s1", "Edge from s1 should keep original id 's1'"
    assert connects[0].args["to_node"] == "n_llm"
    assert connects[1].args["from_node"] == "s2", "Edge from s2 should keep original id 's2'"
    assert connects[1].args["to_node"] == "n_llm"


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
    assert connect.args == {"from_node": "n1", "to_node": "n2"}
