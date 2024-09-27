from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.run_condition import RunCondition
from core.workflow.utils.condition.entities import Condition


def test_init():
    graph_config = {
        "edges": [
            {
                "id": "llm-source-answer-target",
                "source": "llm",
                "target": "answer",
            },
            {
                "id": "start-source-qc-target",
                "source": "start",
                "target": "qc",
            },
            {
                "id": "qc-1-llm-target",
                "source": "qc",
                "sourceHandle": "1",
                "target": "llm",
            },
            {
                "id": "qc-2-http-target",
                "source": "qc",
                "sourceHandle": "2",
                "target": "http",
            },
            {
                "id": "http-source-answer2-target",
                "source": "http",
                "target": "answer2",
            },
        ],
        "nodes": [
            {"data": {"type": "start"}, "id": "start"},
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm",
            },
            {
                "data": {"type": "answer", "title": "answer", "answer": "1"},
                "id": "answer",
            },
            {
                "data": {"type": "question-classifier"},
                "id": "qc",
            },
            {
                "data": {
                    "type": "http-request",
                },
                "id": "http",
            },
            {
                "data": {"type": "answer", "title": "answer", "answer": "1"},
                "id": "answer2",
            },
        ],
    }

    graph = Graph.init(graph_config=graph_config)

    start_node_id = "start"

    assert graph.root_node_id == start_node_id
    assert graph.edge_mapping.get(start_node_id)[0].target_node_id == "qc"
    assert {"llm", "http"} == {node.target_node_id for node in graph.edge_mapping.get("qc")}


def test__init_iteration_graph():
    graph_config = {
        "edges": [
            {
                "id": "llm-answer",
                "source": "llm",
                "sourceHandle": "source",
                "target": "answer",
            },
            {
                "id": "iteration-source-llm-target",
                "source": "iteration",
                "sourceHandle": "source",
                "target": "llm",
            },
            {
                "id": "template-transform-in-iteration-source-llm-in-iteration-target",
                "source": "template-transform-in-iteration",
                "sourceHandle": "source",
                "target": "llm-in-iteration",
            },
            {
                "id": "llm-in-iteration-source-answer-in-iteration-target",
                "source": "llm-in-iteration",
                "sourceHandle": "source",
                "target": "answer-in-iteration",
            },
            {
                "id": "start-source-code-target",
                "source": "start",
                "sourceHandle": "source",
                "target": "code",
            },
            {
                "id": "code-source-iteration-target",
                "source": "code",
                "sourceHandle": "source",
                "target": "iteration",
            },
        ],
        "nodes": [
            {
                "data": {
                    "type": "start",
                },
                "id": "start",
            },
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm",
            },
            {
                "data": {"type": "answer", "title": "answer", "answer": "1"},
                "id": "answer",
            },
            {
                "data": {"type": "iteration"},
                "id": "iteration",
            },
            {
                "data": {
                    "type": "template-transform",
                },
                "id": "template-transform-in-iteration",
                "parentId": "iteration",
            },
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm-in-iteration",
                "parentId": "iteration",
            },
            {
                "data": {"type": "answer", "title": "answer", "answer": "1"},
                "id": "answer-in-iteration",
                "parentId": "iteration",
            },
            {
                "data": {
                    "type": "code",
                },
                "id": "code",
            },
        ],
    }

    graph = Graph.init(graph_config=graph_config, root_node_id="template-transform-in-iteration")
    graph.add_extra_edge(
        source_node_id="answer-in-iteration",
        target_node_id="template-transform-in-iteration",
        run_condition=RunCondition(
            type="condition",
            conditions=[Condition(variable_selector=["iteration", "index"], comparison_operator="≤", value="5")],
        ),
    )

    # iteration:
    #   [template-transform-in-iteration -> llm-in-iteration -> answer-in-iteration]

    assert graph.root_node_id == "template-transform-in-iteration"
    assert graph.edge_mapping.get("template-transform-in-iteration")[0].target_node_id == "llm-in-iteration"
    assert graph.edge_mapping.get("llm-in-iteration")[0].target_node_id == "answer-in-iteration"
    assert graph.edge_mapping.get("answer-in-iteration")[0].target_node_id == "template-transform-in-iteration"


def test_parallels_graph():
    graph_config = {
        "edges": [
            {
                "id": "start-source-llm1-target",
                "source": "start",
                "target": "llm1",
            },
            {
                "id": "start-source-llm2-target",
                "source": "start",
                "target": "llm2",
            },
            {
                "id": "start-source-llm3-target",
                "source": "start",
                "target": "llm3",
            },
            {
                "id": "llm1-source-answer-target",
                "source": "llm1",
                "target": "answer",
            },
            {
                "id": "llm2-source-answer-target",
                "source": "llm2",
                "target": "answer",
            },
            {
                "id": "llm3-source-answer-target",
                "source": "llm3",
                "target": "answer",
            },
        ],
        "nodes": [
            {"data": {"type": "start"}, "id": "start"},
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm1",
            },
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm2",
            },
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm3",
            },
            {
                "data": {"type": "answer", "title": "answer", "answer": "1"},
                "id": "answer",
            },
        ],
    }

    graph = Graph.init(graph_config=graph_config)

    assert graph.root_node_id == "start"
    for i in range(3):
        start_edges = graph.edge_mapping.get("start")
        assert start_edges is not None
        assert start_edges[i].target_node_id == f"llm{i + 1}"

        llm_edges = graph.edge_mapping.get(f"llm{i + 1}")
        assert llm_edges is not None
        assert llm_edges[0].target_node_id == "answer"

    assert len(graph.parallel_mapping) == 1
    assert len(graph.node_parallel_mapping) == 3

    for node_id in ["llm1", "llm2", "llm3"]:
        assert node_id in graph.node_parallel_mapping


def test_parallels_graph2():
    graph_config = {
        "edges": [
            {
                "id": "start-source-llm1-target",
                "source": "start",
                "target": "llm1",
            },
            {
                "id": "start-source-llm2-target",
                "source": "start",
                "target": "llm2",
            },
            {
                "id": "start-source-llm3-target",
                "source": "start",
                "target": "llm3",
            },
            {
                "id": "llm1-source-answer-target",
                "source": "llm1",
                "target": "answer",
            },
            {
                "id": "llm2-source-answer-target",
                "source": "llm2",
                "target": "answer",
            },
        ],
        "nodes": [
            {"data": {"type": "start"}, "id": "start"},
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm1",
            },
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm2",
            },
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm3",
            },
            {
                "data": {"type": "answer", "title": "answer", "answer": "1"},
                "id": "answer",
            },
        ],
    }

    graph = Graph.init(graph_config=graph_config)

    assert graph.root_node_id == "start"
    for i in range(3):
        assert graph.edge_mapping.get("start")[i].target_node_id == f"llm{i + 1}"

        if i < 2:
            assert graph.edge_mapping.get(f"llm{i + 1}") is not None
            assert graph.edge_mapping.get(f"llm{i + 1}")[0].target_node_id == "answer"

    assert len(graph.parallel_mapping) == 1
    assert len(graph.node_parallel_mapping) == 3

    for node_id in ["llm1", "llm2", "llm3"]:
        assert node_id in graph.node_parallel_mapping


def test_parallels_graph3():
    graph_config = {
        "edges": [
            {
                "id": "start-source-llm1-target",
                "source": "start",
                "target": "llm1",
            },
            {
                "id": "start-source-llm2-target",
                "source": "start",
                "target": "llm2",
            },
            {
                "id": "start-source-llm3-target",
                "source": "start",
                "target": "llm3",
            },
        ],
        "nodes": [
            {"data": {"type": "start"}, "id": "start"},
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm1",
            },
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm2",
            },
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm3",
            },
            {
                "data": {"type": "answer", "title": "answer", "answer": "1"},
                "id": "answer",
            },
        ],
    }

    graph = Graph.init(graph_config=graph_config)

    assert graph.root_node_id == "start"
    for i in range(3):
        assert graph.edge_mapping.get("start")[i].target_node_id == f"llm{i + 1}"

    assert len(graph.parallel_mapping) == 1
    assert len(graph.node_parallel_mapping) == 3

    for node_id in ["llm1", "llm2", "llm3"]:
        assert node_id in graph.node_parallel_mapping


def test_parallels_graph4():
    graph_config = {
        "edges": [
            {
                "id": "start-source-llm1-target",
                "source": "start",
                "target": "llm1",
            },
            {
                "id": "start-source-llm2-target",
                "source": "start",
                "target": "llm2",
            },
            {
                "id": "start-source-llm3-target",
                "source": "start",
                "target": "llm3",
            },
            {
                "id": "llm1-source-answer-target",
                "source": "llm1",
                "target": "code1",
            },
            {
                "id": "llm2-source-answer-target",
                "source": "llm2",
                "target": "code2",
            },
            {
                "id": "llm3-source-code3-target",
                "source": "llm3",
                "target": "code3",
            },
            {
                "id": "code1-source-answer-target",
                "source": "code1",
                "target": "answer",
            },
            {
                "id": "code2-source-answer-target",
                "source": "code2",
                "target": "answer",
            },
            {
                "id": "code3-source-answer-target",
                "source": "code3",
                "target": "answer",
            },
        ],
        "nodes": [
            {"data": {"type": "start"}, "id": "start"},
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm1",
            },
            {
                "data": {
                    "type": "code",
                },
                "id": "code1",
            },
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm2",
            },
            {
                "data": {
                    "type": "code",
                },
                "id": "code2",
            },
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm3",
            },
            {
                "data": {
                    "type": "code",
                },
                "id": "code3",
            },
            {
                "data": {"type": "answer", "title": "answer", "answer": "1"},
                "id": "answer",
            },
        ],
    }

    graph = Graph.init(graph_config=graph_config)

    assert graph.root_node_id == "start"
    for i in range(3):
        assert graph.edge_mapping.get("start")[i].target_node_id == f"llm{i + 1}"
        assert graph.edge_mapping.get(f"llm{i + 1}") is not None
        assert graph.edge_mapping.get(f"llm{i + 1}")[0].target_node_id == f"code{i + 1}"
        assert graph.edge_mapping.get(f"code{i + 1}") is not None
        assert graph.edge_mapping.get(f"code{i + 1}")[0].target_node_id == "answer"

    assert len(graph.parallel_mapping) == 1
    assert len(graph.node_parallel_mapping) == 6

    for node_id in ["llm1", "llm2", "llm3", "code1", "code2", "code3"]:
        assert node_id in graph.node_parallel_mapping


def test_parallels_graph5():
    graph_config = {
        "edges": [
            {
                "id": "start-source-llm1-target",
                "source": "start",
                "target": "llm1",
            },
            {
                "id": "start-source-llm2-target",
                "source": "start",
                "target": "llm2",
            },
            {
                "id": "start-source-llm3-target",
                "source": "start",
                "target": "llm3",
            },
            {
                "id": "start-source-llm3-target",
                "source": "start",
                "target": "llm4",
            },
            {
                "id": "start-source-llm3-target",
                "source": "start",
                "target": "llm5",
            },
            {
                "id": "llm1-source-code1-target",
                "source": "llm1",
                "target": "code1",
            },
            {
                "id": "llm2-source-code1-target",
                "source": "llm2",
                "target": "code1",
            },
            {
                "id": "llm3-source-code2-target",
                "source": "llm3",
                "target": "code2",
            },
            {
                "id": "llm4-source-code2-target",
                "source": "llm4",
                "target": "code2",
            },
            {
                "id": "llm5-source-code3-target",
                "source": "llm5",
                "target": "code3",
            },
            {
                "id": "code1-source-answer-target",
                "source": "code1",
                "target": "answer",
            },
            {
                "id": "code2-source-answer-target",
                "source": "code2",
                "target": "answer",
            },
        ],
        "nodes": [
            {"data": {"type": "start"}, "id": "start"},
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm1",
            },
            {
                "data": {
                    "type": "code",
                },
                "id": "code1",
            },
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm2",
            },
            {
                "data": {
                    "type": "code",
                },
                "id": "code2",
            },
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm3",
            },
            {
                "data": {
                    "type": "code",
                },
                "id": "code3",
            },
            {
                "data": {"type": "answer", "title": "answer", "answer": "1"},
                "id": "answer",
            },
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm4",
            },
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm5",
            },
        ],
    }

    graph = Graph.init(graph_config=graph_config)

    assert graph.root_node_id == "start"
    for i in range(5):
        assert graph.edge_mapping.get("start")[i].target_node_id == f"llm{i + 1}"

    assert graph.edge_mapping.get("llm1") is not None
    assert graph.edge_mapping.get("llm1")[0].target_node_id == "code1"
    assert graph.edge_mapping.get("llm2") is not None
    assert graph.edge_mapping.get("llm2")[0].target_node_id == "code1"
    assert graph.edge_mapping.get("llm3") is not None
    assert graph.edge_mapping.get("llm3")[0].target_node_id == "code2"
    assert graph.edge_mapping.get("llm4") is not None
    assert graph.edge_mapping.get("llm4")[0].target_node_id == "code2"
    assert graph.edge_mapping.get("llm5") is not None
    assert graph.edge_mapping.get("llm5")[0].target_node_id == "code3"
    assert graph.edge_mapping.get("code1") is not None
    assert graph.edge_mapping.get("code1")[0].target_node_id == "answer"
    assert graph.edge_mapping.get("code2") is not None
    assert graph.edge_mapping.get("code2")[0].target_node_id == "answer"

    assert len(graph.parallel_mapping) == 1
    assert len(graph.node_parallel_mapping) == 8

    for node_id in ["llm1", "llm2", "llm3", "llm4", "llm5", "code1", "code2", "code3"]:
        assert node_id in graph.node_parallel_mapping


def test_parallels_graph6():
    graph_config = {
        "edges": [
            {
                "id": "start-source-llm1-target",
                "source": "start",
                "target": "llm1",
            },
            {
                "id": "start-source-llm2-target",
                "source": "start",
                "target": "llm2",
            },
            {
                "id": "start-source-llm3-target",
                "source": "start",
                "target": "llm3",
            },
            {
                "id": "llm1-source-code1-target",
                "source": "llm1",
                "target": "code1",
            },
            {
                "id": "llm1-source-code2-target",
                "source": "llm1",
                "target": "code2",
            },
            {
                "id": "llm2-source-code3-target",
                "source": "llm2",
                "target": "code3",
            },
            {
                "id": "code1-source-answer-target",
                "source": "code1",
                "target": "answer",
            },
            {
                "id": "code2-source-answer-target",
                "source": "code2",
                "target": "answer",
            },
            {
                "id": "code3-source-answer-target",
                "source": "code3",
                "target": "answer",
            },
            {
                "id": "llm3-source-answer-target",
                "source": "llm3",
                "target": "answer",
            },
        ],
        "nodes": [
            {"data": {"type": "start"}, "id": "start"},
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm1",
            },
            {
                "data": {
                    "type": "code",
                },
                "id": "code1",
            },
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm2",
            },
            {
                "data": {
                    "type": "code",
                },
                "id": "code2",
            },
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm3",
            },
            {
                "data": {
                    "type": "code",
                },
                "id": "code3",
            },
            {
                "data": {"type": "answer", "title": "answer", "answer": "1"},
                "id": "answer",
            },
        ],
    }

    graph = Graph.init(graph_config=graph_config)

    assert graph.root_node_id == "start"
    for i in range(3):
        assert graph.edge_mapping.get("start")[i].target_node_id == f"llm{i + 1}"

    assert graph.edge_mapping.get("llm1") is not None
    assert graph.edge_mapping.get("llm1")[0].target_node_id == "code1"
    assert graph.edge_mapping.get("llm1") is not None
    assert graph.edge_mapping.get("llm1")[1].target_node_id == "code2"
    assert graph.edge_mapping.get("llm2") is not None
    assert graph.edge_mapping.get("llm2")[0].target_node_id == "code3"
    assert graph.edge_mapping.get("code1") is not None
    assert graph.edge_mapping.get("code1")[0].target_node_id == "answer"
    assert graph.edge_mapping.get("code2") is not None
    assert graph.edge_mapping.get("code2")[0].target_node_id == "answer"
    assert graph.edge_mapping.get("code3") is not None
    assert graph.edge_mapping.get("code3")[0].target_node_id == "answer"

    assert len(graph.parallel_mapping) == 2
    assert len(graph.node_parallel_mapping) == 6

    for node_id in ["llm1", "llm2", "llm3", "code1", "code2", "code3"]:
        assert node_id in graph.node_parallel_mapping

    parent_parallel = None
    child_parallel = None
    for p_id, parallel in graph.parallel_mapping.items():
        if parallel.parent_parallel_id is None:
            parent_parallel = parallel
        else:
            child_parallel = parallel

    for node_id in ["llm1", "llm2", "llm3", "code3"]:
        assert graph.node_parallel_mapping[node_id] == parent_parallel.id

    for node_id in ["code1", "code2"]:
        assert graph.node_parallel_mapping[node_id] == child_parallel.id
