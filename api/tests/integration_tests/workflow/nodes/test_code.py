"""Sandbox-backed CodeNode execution tests."""

import time
import uuid

import pytest

from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.system_variables import build_system_variables
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.graph import Graph
from graphon.node_events import NodeRunResult
from graphon.nodes.code.code_node import CodeNode
from graphon.nodes.code.entities import CodeNodeData
from graphon.nodes.code.limits import CodeNodeLimits
from graphon.runtime import GraphRuntimeState, VariablePool
from tests.workflow_test_utils import build_test_graph_init_params

pytest_plugins = ("tests.integration_tests.workflow.nodes.__mock.code_executor",)


def _init_code_node(code_config: dict) -> CodeNode:
    graph_config = {
        "edges": [{"id": "start-source-code-target", "source": "start", "target": "code"}],
        "nodes": [{"data": {"type": "start", "title": "Start"}, "id": "start"}, code_config],
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
    variable_pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(user_id="aaa", files=[]),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    variable_pool.add(["code", "args1"], 1)
    variable_pool.add(["code", "args2"], 2)
    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())
    node_factory = DifyNodeFactory(graph_init_params=init_params, graph_runtime_state=graph_runtime_state)
    Graph.init(graph_config=graph_config, node_factory=node_factory, root_node_id="start")
    return CodeNode(
        node_id=str(uuid.uuid4()),
        data=CodeNodeData.model_validate(code_config["data"]),
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
        code_executor=node_factory._code_executor,
        code_limits=CodeNodeLimits(
            max_string_length=dify_config.CODE_MAX_STRING_LENGTH,
            max_number=dify_config.CODE_MAX_NUMBER,
            min_number=dify_config.CODE_MIN_NUMBER,
            max_precision=dify_config.CODE_MAX_PRECISION,
            max_depth=dify_config.CODE_MAX_DEPTH,
            max_number_array_length=dify_config.CODE_MAX_NUMBER_ARRAY_LENGTH,
            max_string_array_length=dify_config.CODE_MAX_STRING_ARRAY_LENGTH,
            max_object_array_length=dify_config.CODE_MAX_OBJECT_ARRAY_LENGTH,
        ),
    )


def _code_config(code: str, output_type: str, *, variables: bool = True) -> dict:
    selectors = []
    if variables:
        selectors = [
            {"variable": "args1", "value_selector": ["1", "args1"]},
            {"variable": "args2", "value_selector": ["1", "args2"]},
        ]
    return {
        "id": "code",
        "data": {
            "type": "code",
            "outputs": {"result": {"type": output_type}},
            "title": "Code",
            "variables": selectors,
            "code_language": "python3",
            "code": code,
        },
    }


@pytest.mark.parametrize("setup_code_executor_mock", [["none"]], indirect=True)
def test_execute_code(setup_code_executor_mock) -> None:
    code = "def main(args1: int, args2: int):\n    return {'result': args1 + args2}"
    node = _init_code_node(_code_config(code, "number"))
    node.graph_runtime_state.variable_pool.add(["1", "args1"], 1)
    node.graph_runtime_state.variable_pool.add(["1", "args2"], 2)

    result = node._run()

    assert isinstance(result, NodeRunResult)
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["result"] == 3
    assert result.error == ""


@pytest.mark.parametrize("setup_code_executor_mock", [["none"]], indirect=True)
def test_execute_code_output_validator(setup_code_executor_mock) -> None:
    code = "def main(args1: int, args2: int):\n    return {'result': args1 + args2}"
    node = _init_code_node(_code_config(code, "string"))
    node.graph_runtime_state.variable_pool.add(["1", "args1"], 1)
    node.graph_runtime_state.variable_pool.add(["1", "args2"], 2)

    result = node._run()

    assert isinstance(result, NodeRunResult)
    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error == "Output result must be a string, got int instead."


@pytest.mark.parametrize("setup_code_executor_mock", [["none"]], indirect=True)
def test_execute_code_scientific_notation(setup_code_executor_mock) -> None:
    code = "def main():\n    return {'result': -8.0E-5}"
    node = _init_code_node(_code_config(code, "number", variables=False))

    result = node._run()

    assert isinstance(result, NodeRunResult)
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["result"] == -8e-5
