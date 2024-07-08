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
            }
        ],
        "nodes": [
            {
                "data": {
                    "type": "start"
                },
                "id": "start"
            },
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm"
            },
            {
                "data": {
                    "type": "answer",
                },
                "id": "answer",
            },
            {
                "data": {
                    "type": "question-classifier"
                },
                "id": "qc",
            },
            {
                "data": {
                    "type": "http-request",
                },
                "id": "http",
            },
            {
                "data": {
                    "type": "answer",
                },
                "id": "answer2",
            }
        ],
    }

    graph = Graph.init(
        graph_config=graph_config
    )

    start_node_id = "start"

    assert graph.root_node_id == start_node_id
    assert graph.edge_mapping.get(start_node_id)[0].target_node_id == "qc"
    assert {"llm", "http"} == {node.target_node_id for node in graph.edge_mapping.get("qc")}


def test__init_graph_with_iteration():
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
            }
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
                "data": {
                    "type": "answer",
                },
                "id": "answer",
            },
            {
                "data": {
                    "type": "iteration"
                },
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
                "data": {
                    "type": "answer",
                },
                "id": "answer-in-iteration",
                "parentId": "iteration",
            },
            {
                "data": {
                    "type": "code",
                },
                "id": "code",
            }
        ]
    }

    graph = Graph.init(
        graph_config=graph_config,
        root_node_id="template-transform-in-iteration"
    )
    graph.add_extra_edge(
        source_node_id="answer-in-iteration",
        target_node_id="template-transform-in-iteration",
        run_condition=RunCondition(
            type="condition",
            conditions=[
                Condition(
                    variable_selector=["iteration", "index"],
                    comparison_operator="≤",
                    value="5"
                )
            ]
        )
    )

    # iteration:
    #   [template-transform-in-iteration -> llm-in-iteration -> answer-in-iteration]

    assert graph.root_node_id == "template-transform-in-iteration"
    assert graph.edge_mapping.get("template-transform-in-iteration")[0].target_node_id == "llm-in-iteration"
    assert graph.edge_mapping.get("llm-in-iteration")[0].target_node_id == "answer-in-iteration"
    assert graph.edge_mapping.get("answer-in-iteration")[0].target_node_id == "template-transform-in-iteration"
