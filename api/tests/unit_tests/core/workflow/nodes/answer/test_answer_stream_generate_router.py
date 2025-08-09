import time

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities import GraphInitParams, GraphRuntimeState, VariablePool
from core.workflow.graph import Graph
from core.workflow.nodes.answer.answer_stream_generate_router import AnswerStreamGeneratorRouter
from core.workflow.nodes.node_factory import DifyNodeFactory
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom


@pytest.mark.skip(reason="Test depends on old graph engine attributes (node_id_config_mapping, reverse_edge_mapping)")
def test_init():
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
                "id": "llm3-source-llm4-target",
                "source": "llm3",
                "target": "llm4",
            },
            {
                "id": "llm3-source-llm5-target",
                "source": "llm3",
                "target": "llm5",
            },
            {
                "id": "llm4-source-answer2-target",
                "source": "llm4",
                "target": "answer2",
            },
            {
                "id": "llm5-source-answer-target",
                "source": "llm5",
                "target": "answer",
            },
            {
                "id": "answer2-source-answer-target",
                "source": "answer2",
                "target": "answer",
            },
            {
                "id": "llm2-source-answer-target",
                "source": "llm2",
                "target": "answer",
            },
            {
                "id": "llm1-source-answer-target",
                "source": "llm1",
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
            {
                "data": {"type": "answer", "title": "answer", "answer": "1{{#llm2.text#}}2"},
                "id": "answer",
            },
            {
                "data": {"type": "answer", "title": "answer2", "answer": "1{{#llm3.text#}}2"},
                "id": "answer2",
            },
        ],
    }

    # Create basic setup for graph initialization
    init_params = GraphInitParams(
        tenant_id="1",
        app_id="1",
        workflow_id="1",
        graph_config=graph_config,
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    pool = VariablePool(
        system_variables=SystemVariable(user_id="aaa", files=[]),
        user_inputs={},
        environment_variables=[],
    )

    graph_runtime_state = GraphRuntimeState(variable_pool=pool, start_at=time.perf_counter())
    node_factory = DifyNodeFactory(init_params, graph_runtime_state)
    graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

    answer_stream_generate_route = AnswerStreamGeneratorRouter.init(
        node_id_config_mapping=graph.node_id_config_mapping, reverse_edge_mapping=graph.reverse_edge_mapping
    )

    assert answer_stream_generate_route.answer_dependencies["answer"] == ["answer2"]
    assert answer_stream_generate_route.answer_dependencies["answer2"] == []
