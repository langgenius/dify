import time
import uuid
from os import getenv
from typing import cast

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariableKey
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.graph_init_params import GraphInitParams
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.nodes.code.code_node import CodeNode
from core.workflow.nodes.code.entities import CodeNodeData
from models.enums import UserFrom
from models.workflow import WorkflowNodeExecutionStatus, WorkflowType
from tests.integration_tests.workflow.nodes.__mock.code_executor import setup_code_executor_mock

CODE_MAX_STRING_LENGTH = int(getenv("CODE_MAX_STRING_LENGTH", "10000"))


def init_code_node(code_config: dict):
    graph_config = {
        "edges": [
            {
                "id": "start-source-code-target",
                "source": "start",
                "target": "code",
            },
        ],
        "nodes": [{"data": {"type": "start"}, "id": "start"}, code_config],
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
    variable_pool.add(["code", "123", "args1"], 1)
    variable_pool.add(["code", "123", "args2"], 2)

    node = CodeNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph=graph,
        graph_runtime_state=GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter()),
        config=code_config,
    )

    return node


@pytest.mark.parametrize("setup_code_executor_mock", [["none"]], indirect=True)
def test_execute_code(setup_code_executor_mock):
    code = """
    def main(args1: int, args2: int) -> dict:
        return {
            "result": args1 + args2,
        }
    """
    # trim first 4 spaces at the beginning of each line
    code = "\n".join([line[4:] for line in code.split("\n")])

    code_config = {
        "id": "code",
        "data": {
            "outputs": {
                "result": {
                    "type": "number",
                },
            },
            "title": "123",
            "variables": [
                {
                    "variable": "args1",
                    "value_selector": ["1", "123", "args1"],
                },
                {"variable": "args2", "value_selector": ["1", "123", "args2"]},
            ],
            "answer": "123",
            "code_language": "python3",
            "code": code,
        },
    }

    node = init_code_node(code_config)

    # execute node
    result = node._run()
    assert isinstance(result, NodeRunResult)
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["result"] == 3
    assert result.error is None


@pytest.mark.parametrize("setup_code_executor_mock", [["none"]], indirect=True)
def test_execute_code_output_validator(setup_code_executor_mock):
    code = """
    def main(args1: int, args2: int) -> dict:
        return {
            "result": args1 + args2,
        }
    """
    # trim first 4 spaces at the beginning of each line
    code = "\n".join([line[4:] for line in code.split("\n")])

    code_config = {
        "id": "code",
        "data": {
            "outputs": {
                "result": {
                    "type": "string",
                },
            },
            "title": "123",
            "variables": [
                {
                    "variable": "args1",
                    "value_selector": ["1", "123", "args1"],
                },
                {"variable": "args2", "value_selector": ["1", "123", "args2"]},
            ],
            "answer": "123",
            "code_language": "python3",
            "code": code,
        },
    }

    node = init_code_node(code_config)

    # execute node
    result = node._run()
    assert isinstance(result, NodeRunResult)
    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error == "Output variable `result` must be a string"


def test_execute_code_output_validator_depth():
    code = """
    def main(args1: int, args2: int) -> dict:
        return {
            "result": {
                "result": args1 + args2,
            }
        }
    """
    # trim first 4 spaces at the beginning of each line
    code = "\n".join([line[4:] for line in code.split("\n")])

    code_config = {
        "id": "code",
        "data": {
            "outputs": {
                "string_validator": {
                    "type": "string",
                },
                "number_validator": {
                    "type": "number",
                },
                "number_array_validator": {
                    "type": "array[number]",
                },
                "string_array_validator": {
                    "type": "array[string]",
                },
                "object_validator": {
                    "type": "object",
                    "children": {
                        "result": {
                            "type": "number",
                        },
                        "depth": {
                            "type": "object",
                            "children": {
                                "depth": {
                                    "type": "object",
                                    "children": {
                                        "depth": {
                                            "type": "number",
                                        }
                                    },
                                }
                            },
                        },
                    },
                },
            },
            "title": "123",
            "variables": [
                {
                    "variable": "args1",
                    "value_selector": ["1", "123", "args1"],
                },
                {"variable": "args2", "value_selector": ["1", "123", "args2"]},
            ],
            "answer": "123",
            "code_language": "python3",
            "code": code,
        },
    }

    node = init_code_node(code_config)

    # construct result
    result = {
        "number_validator": 1,
        "string_validator": "1",
        "number_array_validator": [1, 2, 3, 3.333],
        "string_array_validator": ["1", "2", "3"],
        "object_validator": {"result": 1, "depth": {"depth": {"depth": 1}}},
    }

    node.node_data = cast(CodeNodeData, node.node_data)

    # validate
    node._transform_result(result, node.node_data.outputs)

    # construct result
    result = {
        "number_validator": "1",
        "string_validator": 1,
        "number_array_validator": ["1", "2", "3", "3.333"],
        "string_array_validator": [1, 2, 3],
        "object_validator": {"result": "1", "depth": {"depth": {"depth": "1"}}},
    }

    # validate
    with pytest.raises(ValueError):
        node._transform_result(result, node.node_data.outputs)

    # construct result
    result = {
        "number_validator": 1,
        "string_validator": (CODE_MAX_STRING_LENGTH + 1) * "1",
        "number_array_validator": [1, 2, 3, 3.333],
        "string_array_validator": ["1", "2", "3"],
        "object_validator": {"result": 1, "depth": {"depth": {"depth": 1}}},
    }

    # validate
    with pytest.raises(ValueError):
        node._transform_result(result, node.node_data.outputs)

    # construct result
    result = {
        "number_validator": 1,
        "string_validator": "1",
        "number_array_validator": [1, 2, 3, 3.333] * 2000,
        "string_array_validator": ["1", "2", "3"],
        "object_validator": {"result": 1, "depth": {"depth": {"depth": 1}}},
    }

    # validate
    with pytest.raises(ValueError):
        node._transform_result(result, node.node_data.outputs)


def test_execute_code_output_object_list():
    code = """
    def main(args1: int, args2: int) -> dict:
        return {
            "result": {
                "result": args1 + args2,
            }
        }
    """
    # trim first 4 spaces at the beginning of each line
    code = "\n".join([line[4:] for line in code.split("\n")])

    code_config = {
        "id": "code",
        "data": {
            "outputs": {
                "object_list": {
                    "type": "array[object]",
                },
            },
            "title": "123",
            "variables": [
                {
                    "variable": "args1",
                    "value_selector": ["1", "123", "args1"],
                },
                {"variable": "args2", "value_selector": ["1", "123", "args2"]},
            ],
            "answer": "123",
            "code_language": "python3",
            "code": code,
        },
    }

    node = init_code_node(code_config)

    # construct result
    result = {
        "object_list": [
            {
                "result": 1,
            },
            {
                "result": 2,
            },
            {
                "result": [1, 2, 3],
            },
        ]
    }

    node.node_data = cast(CodeNodeData, node.node_data)

    # validate
    node._transform_result(result, node.node_data.outputs)

    # construct result
    result = {
        "object_list": [
            {
                "result": 1,
            },
            {
                "result": 2,
            },
            {
                "result": [1, 2, 3],
            },
            1,
        ]
    }

    # validate
    with pytest.raises(ValueError):
        node._transform_result(result, node.node_data.outputs)
