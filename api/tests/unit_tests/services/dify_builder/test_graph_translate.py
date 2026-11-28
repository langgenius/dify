from core.dify_builder.models import Graph, MutationIntent


def test_to_intents_translates_nodes_then_edges_preserving_ids() -> None:
    from services.dify_builder.agent.graph_translate import to_intents

    graph: Graph = {
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


def test_to_intents_preserves_original_start_id_and_references() -> None:
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


def test_to_intents_carries_branch_handles_through_connect() -> None:
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


def test_to_intents_preserves_nesting_and_layout() -> None:
    """Un-nested children make an iteration non-functional, and a discarded
    position throws away the generator's computed layout."""
    from services.dify_builder.agent.graph_translate import to_intents

    graph: Graph = {
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


def _apply_all(graph: Graph) -> tuple[Graph, list[MutationIntent]]:
    """Drive a generator-shaped graph all the way to a persisted draft graph:
    to_intents -> filter_applicable -> the real APPLY_FNS, exactly as
    build.py:409-416 and dify_port.apply_repair do."""
    from services.dify_builder import graph_ops
    from services.dify_builder.agent.graph_translate import to_intents

    intents = to_intents(graph)
    applicable, rejected, _dry, _changed = graph_ops.filter_applicable({"nodes": [], "edges": []}, intents)
    assert rejected == [], f"intents rejected: {[(i.op, r) for i, r in rejected]}"
    persisted: Graph = {"nodes": [], "edges": []}
    for intent in applicable:
        persisted, _changed = graph_ops.APPLY_FNS[intent.op](persisted, **intent.args)
    return persisted, intents


def test_translated_iteration_graph_validates_against_the_engine() -> None:
    """The regression this branch shipped and this test now blocks: dropping
    the marker / start_node_id / entry edge made EVERY container workflow fail
    `Graph.init` on a required-field ValidationError, which is worse than the
    canvas crash it was meant to fix (ESQ1-288)."""
    from graphon.nodes.iteration.entities import IterationNodeData

    graph: Graph = {
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


def test_translated_loop_graph_validates_against_the_engine() -> None:
    """Same contract for loops -- `LoopNodeData.start_node_id` is required too."""
    from graphon.nodes.loop.entities import LoopNodeData

    graph: Graph = {
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
