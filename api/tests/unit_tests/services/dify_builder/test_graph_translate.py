def test_to_intents_translates_nodes_then_edges_preserving_ids():
    from services.dify_builder.agent.graph_translate import to_intents

    graph = {
        "nodes": [
            {
                "id": "n_start",
                "type": "custom",
                "position": {"x": 0, "y": 0},
                "data": {"type": "start", "title": "Start", "variables": []},
            },
            {
                "id": "n_llm",
                "type": "custom",
                "position": {"x": 1, "y": 0},
                "data": {"type": "llm", "title": "LLM", "model": {"provider": "", "name": ""}},
            },
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
            {
                "id": "node1",
                "type": "custom",
                "data": {
                    "type": "start",
                    "title": "Start",
                    "variables": [{"variable": "document", "type": "file", "required": True}],
                },
            },
            {
                "id": "node2",
                "type": "custom",
                "data": {"type": "document-extractor", "title": "Extract", "variable_selector": ["node1", "document"]},
            },
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


def test_to_intents_skips_synthetic_container_start_nodes():
    """ESQ1-288: these are frontend-synthesized markers. Persisting them as
    generic `custom` nodes crashes the canvas with React error #130."""
    from services.dify_builder.agent.graph_translate import to_intents

    graph = {
        "nodes": [
            {"id": "iter1", "data": {"type": "iteration", "title": "Loop over items"}},
            {"id": "iter1start", "data": {"type": "iteration-start"}},
            {"id": "loop1", "data": {"type": "loop", "title": "Retry"}},
            {"id": "loop1start", "data": {"type": "loop-start"}},
            {"id": "llm1", "data": {"type": "llm", "title": "Summarize"}},
        ],
        "edges": [],
    }
    intents = to_intents(graph)
    created = [i.args["node_id"] for i in intents if i.op == "create_node"]
    assert created == ["iter1", "loop1", "llm1"]
    assert "iter1start" not in created
    assert "loop1start" not in created


def test_to_intents_strips_start_node_id_from_container_config():
    """The frontend regenerates container start markers and rewrites start_node_id.
    Persisting our pointer leaves it dangling, causing TypeError on canvas init."""
    from services.dify_builder.agent.graph_translate import to_intents

    graph = {
        "nodes": [
            {
                "id": "iter1",
                "data": {
                    "type": "iteration",
                    "title": "Loop",
                    "start_node_id": "iter1start",
                    "other_field": "value",
                },
            },
            {"id": "llm1", "data": {"type": "llm", "title": "LLM"}},
        ],
        "edges": [],
    }
    intents = to_intents(graph)
    iter_create = next(i for i in intents if i.args["node_id"] == "iter1")
    # start_node_id should be stripped, but other fields preserved
    assert "start_node_id" not in iter_create.args["config"]
    assert iter_create.args["config"]["title"] == "Loop"
    assert iter_create.args["config"]["other_field"] == "value"


def test_to_intents_skips_edges_to_from_synthetic_nodes():
    """Edges to/from skipped synthetic nodes produce no connect intent,
    keeping the intent list honest about what it asks the backend to create."""
    from services.dify_builder.agent.graph_translate import to_intents

    graph = {
        "nodes": [
            {"id": "iter1", "data": {"type": "iteration", "title": "Loop"}},
            {"id": "iter1start", "data": {"type": "iteration-start"}},
            {"id": "llm1", "data": {"type": "llm", "title": "LLM"}},
            {"id": "llm2", "data": {"type": "llm", "title": "Next"}},
        ],
        "edges": [
            {"id": "e1", "source": "iter1start", "target": "llm1"},  # from synthetic
            {"id": "e2", "source": "llm1", "target": "iter1start"},  # to synthetic
            {"id": "e3", "source": "llm1", "target": "llm2"},  # normal edge
        ],
    }
    intents = to_intents(graph)
    connects = [i for i in intents if i.op == "connect"]
    # Only the normal edge should produce a connect
    assert len(connects) == 1
    assert connects[0].args["from_node"] == "llm1"
    assert connects[0].args["to_node"] == "llm2"


def test_to_intents_preserves_nesting_and_layout():
    """Un-nested children make an iteration non-functional, and a discarded
    position throws away the generator's computed layout."""
    from services.dify_builder.agent.graph_translate import to_intents

    graph = {
        "nodes": [
            {
                "id": "iter1",
                "data": {"type": "iteration", "title": "Loop"},
                "position": {"x": 100, "y": 200},
            },
            {
                "id": "child1",
                "parentId": "iter1",
                "extent": "parent",
                "zIndex": 1002,
                "data": {"type": "llm", "title": "Summarize", "isInIteration": True, "iteration_id": "iter1"},
                "position": {"x": 300, "y": 220},
            },
        ],
        "edges": [],
    }
    by_id = {i.args["node_id"]: i for i in to_intents(graph) if i.op == "create_node"}

    assert by_id["child1"].args["parent_id"] == "iter1"
    assert by_id["child1"].args["position"] == {"x": 300, "y": 220}
    assert by_id["iter1"].args["position"] == {"x": 100, "y": 200}
    assert "parent_id" not in by_id["iter1"].args
    # data-level markers already survived via config -- confirm we didn't lose them
    assert by_id["child1"].args["config"]["iteration_id"] == "iter1"
