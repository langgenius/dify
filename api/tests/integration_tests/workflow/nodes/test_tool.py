import time
import uuid
from unittest.mock import MagicMock, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.tools.utils.configuration import ToolParameterConfigurationManager
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.node_runtime import DifyToolNodeRuntime
from core.workflow.system_variables import build_system_variables
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.graph import Graph
from graphon.node_events import StreamCompletedEvent
from graphon.nodes.protocols import ToolFileManagerProtocol
from graphon.nodes.tool.entities import ToolNodeData
from graphon.nodes.tool.tool_node import ToolNode
from graphon.runtime import GraphRuntimeState, VariablePool
from tests.workflow_test_utils import build_test_graph_init_params


def init_tool_node(config: dict):
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

    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

    # Create node factory
    node_factory = DifyNodeFactory(
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )

    graph = Graph.init(graph_config=graph_config, node_factory=node_factory, root_node_id="start")

    tool_file_manager_factory = MagicMock(spec=ToolFileManagerProtocol)

    node = ToolNode(
        node_id=str(uuid.uuid4()),
        config=ToolNodeData.model_validate(config["data"]),
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
        tool_file_manager_factory=tool_file_manager_factory,
        runtime=DifyToolNodeRuntime(init_params.run_context),
    )
    return node


def test_tool_variable_invoke(monkeypatch: pytest.MonkeyPatch):
    node = init_tool_node(
        config={
            "id": "1",
            "data": {
                "type": "tool",
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

    with patch.object(
        ToolParameterConfigurationManager,
        "decrypt_tool_parameters",
        return_value={"format": "%Y-%m-%d %H:%M:%S"},
    ):
        node.graph_runtime_state.variable_pool.add(["1", "args1"], "1+1")

        # execute node
        result = node._run()
        for item in result:
            if isinstance(item, StreamCompletedEvent):
                assert item.node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
                assert item.node_run_result.outputs is not None
                assert item.node_run_result.outputs.get("text") is not None


def test_tool_mixed_invoke(monkeypatch: pytest.MonkeyPatch):
    node = init_tool_node(
        config={
            "id": "1",
            "data": {
                "type": "tool",
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

    with patch.object(
        ToolParameterConfigurationManager,
        "decrypt_tool_parameters",
        return_value={"format": "%Y-%m-%d %H:%M:%S"},
    ):
        # execute node
        result = node._run()
        for item in result:
            if isinstance(item, StreamCompletedEvent):
                assert item.node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
                assert item.node_run_result.outputs is not None
                assert item.node_run_result.outputs.get("text") is not None
