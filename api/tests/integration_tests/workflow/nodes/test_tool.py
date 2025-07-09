import time
import uuid
from unittest.mock import MagicMock

from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.utils.configuration import ToolParameterConfigurationManager
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.graph_init_params import GraphInitParams
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.nodes.event.event import RunCompletedEvent
from core.workflow.nodes.tool.tool_node import ToolNode
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom
from models.workflow import WorkflowType


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
        system_variables=SystemVariable(user_id="aaa", files=[]),
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
                "provider_id": "time",
                "provider_type": "builtin",
                "provider_name": "time",
                "tool_name": "current_time",
                "tool_label": "current_time",
                "tool_configurations": {},
                "tool_parameters": {},
            },
        }
    )

    ToolParameterConfigurationManager.decrypt_tool_parameters = MagicMock(return_value={"format": "%Y-%m-%d %H:%M:%S"})

    node.graph_runtime_state.variable_pool.add(["1", "123", "args1"], "1+1")

    # execute node
    result = node._run()
    for item in result:
        if isinstance(item, RunCompletedEvent):
            assert item.run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
            assert item.run_result.outputs is not None
            assert item.run_result.outputs.get("text") is not None


def test_tool_mixed_invoke():
    node = init_tool_node(
        config={
            "id": "1",
            "data": {
                "title": "a",
                "desc": "a",
                "provider_id": "time",
                "provider_type": "builtin",
                "provider_name": "time",
                "tool_name": "current_time",
                "tool_label": "current_time",
                "tool_configurations": {
                    "format": "%Y-%m-%d %H:%M:%S",
                },
                "tool_parameters": {},
            },
        }
    )

    ToolParameterConfigurationManager.decrypt_tool_parameters = MagicMock(return_value={"format": "%Y-%m-%d %H:%M:%S"})

    # execute node
    result = node._run()
    for item in result:
        if isinstance(item, RunCompletedEvent):
            assert item.run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
            assert item.run_result.outputs is not None
            assert item.run_result.outputs.get("text") is not None
