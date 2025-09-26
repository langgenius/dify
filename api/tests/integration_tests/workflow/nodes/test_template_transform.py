import time
import uuid

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities import GraphInitParams
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.graph import Graph
from core.workflow.nodes.node_factory import DifyNodeFactory
from core.workflow.nodes.template_transform.template_transform_node import TemplateTransformNode
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom
from tests.integration_tests.workflow.nodes.__mock.code_executor import setup_code_executor_mock


@pytest.mark.parametrize("setup_code_executor_mock", [["none"]], indirect=True)
def test_execute_code(setup_code_executor_mock):
    code = """{{args2}}"""
    config = {
        "id": "1",
        "data": {
            "type": "template-transform",
            "title": "123",
            "variables": [
                {
                    "variable": "args1",
                    "value_selector": ["1", "args1"],
                },
                {"variable": "args2", "value_selector": ["1", "args2"]},
            ],
            "template": code,
        },
    }

    graph_config = {
        "edges": [
            {
                "id": "start-source-next-target",
                "source": "start",
                "target": "1",
            },
        ],
        "nodes": [{"data": {"type": "start", "title": "Start"}, "id": "start"}, config],
    }

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

    # construct variable pool
    variable_pool = VariablePool(
        system_variables=SystemVariable(user_id="aaa", files=[]),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    variable_pool.add(["1", "args1"], 1)
    variable_pool.add(["1", "args2"], 3)

    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

    # Create node factory
    node_factory = DifyNodeFactory(
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )

    graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

    node = TemplateTransformNode(
        id=str(uuid.uuid4()),
        config=config,
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )
    node.init_node_data(config.get("data", {}))

    # execute node
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["output"] == "3"
