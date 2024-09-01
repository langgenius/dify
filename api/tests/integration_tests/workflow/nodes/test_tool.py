import time
import uuid

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariableKey
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.graph_init_params import GraphInitParams
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.nodes.tool.tool_node import ToolNode
from enums import UserFrom
from models.workflow import WorkflowNodeExecutionStatus, WorkflowType


def init_tool_node(config: dict):
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

    return ToolNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph=graph,
        graph_runtime_state=GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter()),
        config=config,
    )


def test_tool_variable_invoke():
    node = init_tool_node(
        config={
            "id": "1",
            "data": {
                "title": "a",
                "desc": "a",
                "provider_id": "maths",
                "provider_type": "builtin",
                "provider_name": "maths",
                "tool_name": "eval_expression",
                "tool_label": "eval_expression",
                "tool_configurations": {},
                "tool_parameters": {
                    "expression": {
                        "type": "variable",
                        "value": ["1", "123", "args1"],
                    }
                },
            },
        }
    )

    node.graph_runtime_state.variable_pool.add(["1", "123", "args1"], "1+1")

    # execute node
    result = node._run()
    assert isinstance(result, NodeRunResult)
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert "2" in result.outputs["text"]
    assert result.outputs["files"] == []


def test_tool_mixed_invoke():
    node = init_tool_node(
        config={
            "id": "1",
            "data": {
                "title": "a",
                "desc": "a",
                "provider_id": "maths",
                "provider_type": "builtin",
                "provider_name": "maths",
                "tool_name": "eval_expression",
                "tool_label": "eval_expression",
                "tool_configurations": {},
                "tool_parameters": {
                    "expression": {
                        "type": "mixed",
                        "value": "{{#1.args1#}}",
                    }
                },
            },
        }
    )

    node.graph_runtime_state.variable_pool.add(["1", "args1"], "1+1")

    # execute node
    result = node._run()
    assert isinstance(result, NodeRunResult)
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert "2" in result.outputs["text"]
    assert result.outputs["files"] == []
