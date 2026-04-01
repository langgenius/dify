import time
import uuid
from unittest.mock import MagicMock

from graphon.enums import WorkflowNodeExecutionStatus
from graphon.graph import Graph
from graphon.nodes.answer.answer_node import AnswerNode
from graphon.runtime import GraphRuntimeState, VariablePool

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.system_variables import build_system_variables
from extensions.ext_database import db
from tests.workflow_test_utils import build_test_graph_init_params


def test_execute_answer():
    graph_config = {
        "edges": [
            {
                "id": "start-source-answer-target",
                "source": "start",
                "target": "answer",
            },
        ],
        "nodes": [
            {"data": {"type": "start", "title": "Start"}, "id": "start"},
            {
                "data": {
                    "title": "123",
                    "type": "answer",
                    "answer": "Today's weather is {{#start.weather#}}\n{{#llm.text#}}\n{{img}}\nFin.",
                },
                "id": "answer",
            },
        ],
    }

    init_params = build_test_graph_init_params(
        workflow_id="1",
        graph_config=graph_config,
        tenant_id="1",
        app_id="1",
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    # construct variable pool
    variable_pool = VariablePool(
        system_variables=build_system_variables(user_id="aaa", files=[]),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    variable_pool.add(["start", "weather"], "sunny")
    variable_pool.add(["llm", "text"], "You are a helpful AI.")

    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

    # create node factory
    node_factory = DifyNodeFactory(
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )

    graph = Graph.init(graph_config=graph_config, node_factory=node_factory, root_node_id="start")

    node_config = {
        "id": "answer",
        "data": {
            "title": "123",
            "type": "answer",
            "answer": "Today's weather is {{#start.weather#}}\n{{#llm.text#}}\n{{img}}\nFin.",
        },
    }

    node = AnswerNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
        config=node_config,
    )

    # Mock db.session.close()
    db.session.close = MagicMock()

    # execute node
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["answer"] == "Today's weather is sunny\nYou are a helpful AI.\n{{img}}\nFin."
