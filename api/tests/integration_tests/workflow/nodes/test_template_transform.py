import time
import uuid

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.node_entities import UserFrom
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariableKey
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.graph_init_params import GraphInitParams
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.nodes.template_transform.template_transform_node import TemplateTransformNode
from models.workflow import WorkflowNodeExecutionStatus, WorkflowType
from tests.integration_tests.workflow.nodes.__mock.code_executor import setup_code_executor_mock


@pytest.mark.parametrize("setup_code_executor_mock", [["none"]], indirect=True)
def test_execute_code(setup_code_executor_mock):
    code = """{{args2}}"""
    config = {
        "id": "1",
        "data": {
            "title": "123",
            "variables": [
                {
                    "variable": "args1",
                    "value_selector": ["1", "123", "args1"],
                },
                {"variable": "args2", "value_selector": ["1", "123", "args2"]},
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
        "nodes": [{"data": {"type": "start"}, "id": "start"}, config],
    }

    graph = Graph.init(graph_config=graph_config)

    init_params = GraphInitParams(
        tenant_id="1",
        app_id="1",
        workflow_type=WorkflowType.WORKFLOW,
        workflow_id="1",
        graph_config=graph_config,
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    # construct variable pool
    variable_pool = VariablePool(
        system_variables={SystemVariableKey.FILES: [], SystemVariableKey.USER_ID: "aaa"},
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    variable_pool.add(["1", "123", "args1"], 1)
    variable_pool.add(["1", "123", "args2"], 3)

    node = TemplateTransformNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph=graph,
        graph_runtime_state=GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter()),
        config=config,
    )

    # execute node
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["output"] == "3"
