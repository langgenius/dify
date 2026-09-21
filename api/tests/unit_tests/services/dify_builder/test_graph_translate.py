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


def test_to_intents_carries_the_container_start_marker_with_its_flow_type():
    """ESQ1-288: the marker is a REAL node the engine roots the body frame at.
    The crash was never the marker -- it was persisting it as a generic
    `custom` node, which the canvas has no component for (React error #130).
    Carry the generator's node-level type instead of dropping the node."""
    from services.dify_builder.agent.graph_translate import to_intents

    graph = {
        "nodes": [
            {"id": "iter1", "type": "custom", "data": {"type": "iteration", "title": "Loop over items"}},
            {"id": "iter1start", "type": "custom-iteration-start", "data": {"type": "iteration-start"}},
            {"id": "loop1", "type": "custom", "data": {"type": "loop", "title": "Retry"}},
            {"id": "loop1start", "type": "custom-loop-start", "data": {"type": "loop-start"}},
            {"id": "llm1", "type": "custom", "data": {"type": "llm", "title": "Summarize"}},
        ],
        "edges": [],
    }
    intents = to_intents(graph)
    creates = {i.args["node_id"]: i for i in intents if i.op == "create_node"}
    assert list(creates) == ["iter1", "iter1start", "loop1", "loop1start", "llm1"]
    assert creates["iter1start"].args["flow_type"] == "custom-iteration-start"
    assert creates["loop1start"].args["flow_type"] == "custom-loop-start"
    # a generic `custom` node carries no flow_type -- _build_node already defaults to it
    assert "flow_type" not in creates["llm1"].args
    assert "flow_type" not in creates["iter1"].args


def test_to_intents_keeps_start_node_id_in_the_container_config():
    """`IterationNodeData.start_node_id` has no default: stripping it makes
    Graph.init fail for the WHOLE draft, not just the container."""
    from services.dify_builder.agent.graph_translate import to_intents

    graph = {
        "nodes": [
            {
                "id": "iter1",
                "type": "custom",
                "data": {
                    "type": "iteration",
                    "title": "Loop",
                    "start_node_id": "iter1start",
                    "other_field": "value",
                },
            },
            {"id": "llm1", "type": "custom", "data": {"type": "llm", "title": "LLM"}},
        ],
        "edges": [],
    }
    intents = to_intents(graph)
    iter_create = next(i for i in intents if i.args["node_id"] == "iter1")
    assert iter_create.args["config"]["start_node_id"] == "iter1start"
    assert iter_create.args["config"]["title"] == "Loop"
    assert iter_create.args["config"]["other_field"] == "value"


def test_to_intents_keeps_the_container_entry_edge():
    """The generator synthesizes `<container>start -> first child`
    (runner.py:1392-1397). Drop it and the body has no incoming edge."""
    from services.dify_builder.agent.graph_translate import to_intents

    graph = {
        "nodes": [
            {"id": "iter1", "type": "custom", "data": {"type": "iteration", "title": "Loop"}},
            {"id": "iter1start", "type": "custom-iteration-start", "data": {"type": "iteration-start"}},
            {"id": "llm1", "type": "custom", "data": {"type": "llm", "title": "LLM"}},
            {"id": "llm2", "type": "custom", "data": {"type": "llm", "title": "Next"}},
        ],
        "edges": [
            {"id": "e1", "source": "iter1start", "target": "llm1"},
            {"id": "e2", "source": "llm1", "target": "llm2"},
        ],
    }
    intents = to_intents(graph)
    connects = [(i.args["from_node"], i.args["to_node"]) for i in intents if i.op == "connect"]
    assert connects == [("iter1start", "llm1"), ("llm1", "llm2")]


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


def _apply_all(graph):
    """Drive a generator-shaped graph all the way to a persisted draft graph:
    to_intents -> filter_applicable -> the real APPLY_FNS, exactly as
    build.py:409-416 and dify_port.apply_repair do."""
    from services.dify_builder import graph_ops
    from services.dify_builder.agent.graph_translate import to_intents

    intents = to_intents(graph)
    applicable, rejected = graph_ops.filter_applicable({"nodes": [], "edges": []}, intents)
    assert rejected == [], f"intents rejected: {[(i.op, r) for i, r in rejected]}"
    persisted = {"nodes": [], "edges": []}
    for intent in applicable:
        persisted, _changed = graph_ops.APPLY_FNS[intent.op](persisted, **intent.args)
    return persisted, intents


def test_translated_iteration_graph_validates_against_the_engine():
    """The regression this branch shipped and this test now blocks: dropping
    the marker / start_node_id / entry edge made EVERY container workflow fail
    `Graph.init` on a required-field ValidationError, which is worse than the
    canvas crash it was meant to fix (ESQ1-288)."""
    from graphon.nodes.iteration.entities import IterationNodeData

    graph = {
        "nodes": [
            {
                "id": "node1",
                "type": "custom",
                "position": {"x": 0, "y": 0},
                "data": {"type": "start", "title": "Start", "variables": []},
            },
            {
                "id": "node2",
                "type": "custom",
                "position": {"x": 300, "y": 0},
                "data": {
                    "type": "iteration",
                    "title": "Iterate",
                    "start_node_id": "node2start",
                    "iterator_selector": ["node1", "items"],
                    "output_selector": ["node3", "text"],
                },
            },
            {
                "id": "node2start",
                "type": "custom-iteration-start",
                "parentId": "node2",
                "extent": "parent",
                "zIndex": 1002,
                "position": {"x": 60, "y": 78},
                "data": {"type": "iteration-start", "title": "", "desc": "", "isInIteration": True},
            },
            {
                "id": "node3",
                "type": "custom",
                "parentId": "node2",
                "extent": "parent",
                "zIndex": 1002,
                "position": {"x": 160, "y": 78},
                "data": {"type": "llm", "title": "Summarize", "isInIteration": True, "iteration_id": "node2"},
            },
        ],
        "edges": [
            {"id": "e1", "source": "node1", "target": "node2"},
            {"id": "e2", "source": "node2start", "target": "node3"},
        ],
    }
    persisted, intents = _apply_all(graph)
    by_id = {n["id"]: n for n in persisted["nodes"]}

    # 1. the container data the engine validates eagerly at graph construction
    IterationNodeData.model_validate(by_id["node2"]["data"])

    # 2. the marker survives WITH the ReactFlow type the canvas has a component for
    assert by_id["node2start"]["type"] == "custom-iteration-start"
    assert by_id["node2start"]["parentId"] == "node2"

    # 3. the body is reachable: the entry edge marker -> first child survives
    connects = [(i.args["from_node"], i.args["to_node"]) for i in intents if i.op == "connect"]
    assert ("node2start", "node3") in connects
    assert ("node2start", "node3") in [(e["source"], e["target"]) for e in persisted["edges"]]


def test_translated_loop_graph_validates_against_the_engine():
    """Same contract for loops -- `LoopNodeData.start_node_id` is required too."""
    from graphon.nodes.loop.entities import LoopNodeData

    graph = {
        "nodes": [
            {
                "id": "node1",
                "type": "custom",
                "position": {"x": 0, "y": 0},
                "data": {"type": "start", "title": "Start", "variables": []},
            },
            {
                "id": "node2",
                "type": "custom",
                "position": {"x": 300, "y": 0},
                "data": {
                    "type": "loop",
                    "title": "Retry",
                    "start_node_id": "node2start",
                    "loop_count": 3,
                    "break_conditions": [],
                    "logical_operator": "and",
                },
            },
            {
                "id": "node2start",
                "type": "custom-loop-start",
                "parentId": "node2",
                "extent": "parent",
                "zIndex": 1002,
                "position": {"x": 60, "y": 78},
                "data": {"type": "loop-start", "title": "", "desc": "", "isInLoop": True},
            },
            {
                "id": "node3",
                "type": "custom",
                "parentId": "node2",
                "extent": "parent",
                "zIndex": 1002,
                "position": {"x": 160, "y": 78},
                "data": {"type": "llm", "title": "Attempt", "isInLoop": True, "loop_id": "node2"},
            },
        ],
        "edges": [
            {"id": "e1", "source": "node1", "target": "node2"},
            {"id": "e2", "source": "node2start", "target": "node3"},
        ],
    }
    persisted, intents = _apply_all(graph)
    by_id = {n["id"]: n for n in persisted["nodes"]}

    LoopNodeData.model_validate(by_id["node2"]["data"])
    assert by_id["node2start"]["type"] == "custom-loop-start"
    assert by_id["node2start"]["parentId"] == "node2"
    assert ("node2start", "node3") in [(i.args["from_node"], i.args["to_node"]) for i in intents if i.op == "connect"]
    assert ("node2start", "node3") in [(e["source"], e["target"]) for e in persisted["edges"]]
