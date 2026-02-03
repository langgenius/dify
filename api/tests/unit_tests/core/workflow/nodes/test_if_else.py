import time
import uuid
from unittest.mock import MagicMock, Mock

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.workflow.node_factory import DifyNodeFactory
from core.file import File, FileTransferMethod, FileType
from core.variables import ArrayFileSegment
from core.workflow.entities import GraphInitParams
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.graph import Graph
from core.workflow.nodes.if_else.entities import IfElseNodeData
from core.workflow.nodes.if_else.if_else_node import IfElseNode
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from core.workflow.utils.condition.entities import Condition, SubCondition, SubVariableCondition
from extensions.ext_database import db
from models.enums import UserFrom


def test_execute_if_else_result_true():
    graph_config = {"edges": [], "nodes": [{"data": {"type": "start", "title": "Start"}, "id": "start"}]}

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
    pool = VariablePool(system_variables=SystemVariable(user_id="aaa", files=[]), user_inputs={})
    pool.add(["start", "array_contains"], ["ab", "def"])
    pool.add(["start", "array_not_contains"], ["ac", "def"])
    pool.add(["start", "contains"], "cabcde")
    pool.add(["start", "not_contains"], "zacde")
    pool.add(["start", "start_with"], "abc")
    pool.add(["start", "end_with"], "zzab")
    pool.add(["start", "is"], "ab")
    pool.add(["start", "is_not"], "aab")
    pool.add(["start", "empty"], "")
    pool.add(["start", "not_empty"], "aaa")
    pool.add(["start", "equals"], 22)
    pool.add(["start", "not_equals"], 23)
    pool.add(["start", "greater_than"], 23)
    pool.add(["start", "less_than"], 21)
    pool.add(["start", "greater_than_or_equal"], 22)
    pool.add(["start", "less_than_or_equal"], 21)
    pool.add(["start", "null"], None)
    pool.add(["start", "not_null"], "1212")

    graph_runtime_state = GraphRuntimeState(variable_pool=pool, start_at=time.perf_counter())
    node_factory = DifyNodeFactory(
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )
    graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

    node_config = {
        "id": "if-else",
        "data": {
            "title": "123",
            "type": "if-else",
            "logical_operator": "and",
            "conditions": [
                {
                    "comparison_operator": "contains",
                    "variable_selector": ["start", "array_contains"],
                    "value": "ab",
                },
                {
                    "comparison_operator": "not contains",
                    "variable_selector": ["start", "array_not_contains"],
                    "value": "ab",
                },
                {"comparison_operator": "contains", "variable_selector": ["start", "contains"], "value": "ab"},
                {
                    "comparison_operator": "not contains",
                    "variable_selector": ["start", "not_contains"],
                    "value": "ab",
                },
                {"comparison_operator": "start with", "variable_selector": ["start", "start_with"], "value": "ab"},
                {"comparison_operator": "end with", "variable_selector": ["start", "end_with"], "value": "ab"},
                {"comparison_operator": "is", "variable_selector": ["start", "is"], "value": "ab"},
                {"comparison_operator": "is not", "variable_selector": ["start", "is_not"], "value": "ab"},
                {"comparison_operator": "empty", "variable_selector": ["start", "empty"], "value": "ab"},
                {"comparison_operator": "not empty", "variable_selector": ["start", "not_empty"], "value": "ab"},
                {"comparison_operator": "=", "variable_selector": ["start", "equals"], "value": "22"},
                {"comparison_operator": "≠", "variable_selector": ["start", "not_equals"], "value": "22"},
                {"comparison_operator": ">", "variable_selector": ["start", "greater_than"], "value": "22"},
                {"comparison_operator": "<", "variable_selector": ["start", "less_than"], "value": "22"},
                {
                    "comparison_operator": "≥",
                    "variable_selector": ["start", "greater_than_or_equal"],
                    "value": "22",
                },
                {"comparison_operator": "≤", "variable_selector": ["start", "less_than_or_equal"], "value": "22"},
                {"comparison_operator": "null", "variable_selector": ["start", "null"]},
                {"comparison_operator": "not null", "variable_selector": ["start", "not_null"]},
            ],
        },
    }

    node = IfElseNode(
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
    assert result.outputs is not None
    assert result.outputs["result"] is True


def test_execute_if_else_result_false():
    # Create a simple graph for IfElse node testing
    graph_config = {"edges": [], "nodes": [{"data": {"type": "start", "title": "Start"}, "id": "start"}]}

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
    pool = VariablePool(
        system_variables=SystemVariable(user_id="aaa", files=[]),
        user_inputs={},
        environment_variables=[],
    )
    pool.add(["start", "array_contains"], ["1ab", "def"])
    pool.add(["start", "array_not_contains"], ["ab", "def"])

    graph_runtime_state = GraphRuntimeState(variable_pool=pool, start_at=time.perf_counter())
    node_factory = DifyNodeFactory(
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )
    graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

    node_config = {
        "id": "if-else",
        "data": {
            "title": "123",
            "type": "if-else",
            "logical_operator": "or",
            "conditions": [
                {
                    "comparison_operator": "contains",
                    "variable_selector": ["start", "array_contains"],
                    "value": "ab",
                },
                {
                    "comparison_operator": "not contains",
                    "variable_selector": ["start", "array_not_contains"],
                    "value": "ab",
                },
            ],
        },
    }

    node = IfElseNode(
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
    assert result.outputs is not None
    assert result.outputs["result"] is False


def test_array_file_contains_file_name():
    node_data = IfElseNodeData(
        title="123",
        logical_operator="and",
        cases=[
            IfElseNodeData.Case(
                case_id="true",
                logical_operator="and",
                conditions=[
                    Condition(
                        comparison_operator="contains",
                        variable_selector=["start", "array_contains"],
                        sub_variable_condition=SubVariableCondition(
                            logical_operator="and",
                            conditions=[
                                SubCondition(
                                    key="name",
                                    comparison_operator="contains",
                                    value="ab",
                                )
                            ],
                        ),
                    )
                ],
            )
        ],
    )

    node_config = {
        "id": "if-else",
        "data": node_data.model_dump(),
    }

    # Create properly configured mock for graph_init_params
    graph_init_params = Mock()
    graph_init_params.tenant_id = "test_tenant"
    graph_init_params.app_id = "test_app"
    graph_init_params.workflow_id = "test_workflow"
    graph_init_params.graph_config = {}
    graph_init_params.user_id = "test_user"
    graph_init_params.user_from = UserFrom.ACCOUNT
    graph_init_params.invoke_from = InvokeFrom.SERVICE_API
    graph_init_params.call_depth = 0

    node = IfElseNode(
        id=str(uuid.uuid4()),
        graph_init_params=graph_init_params,
        graph_runtime_state=Mock(),
        config=node_config,
    )

    node.graph_runtime_state.variable_pool.get.return_value = ArrayFileSegment(
        value=[
            File(
                tenant_id="1",
                type=FileType.IMAGE,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                related_id="1",
                filename="ab",
                storage_key="",
            ),
        ],
    )

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["result"] is True


def _get_test_conditions():
    conditions = [
        # Test boolean "is" operator
        {"comparison_operator": "is", "variable_selector": ["start", "bool_true"], "value": "true"},
        # Test boolean "is not" operator
        {"comparison_operator": "is not", "variable_selector": ["start", "bool_false"], "value": "true"},
        # Test boolean "=" operator
        {"comparison_operator": "=", "variable_selector": ["start", "bool_true"], "value": "1"},
        # Test boolean "≠" operator
        {"comparison_operator": "≠", "variable_selector": ["start", "bool_false"], "value": "1"},
        # Test boolean "not null" operator
        {"comparison_operator": "not null", "variable_selector": ["start", "bool_true"]},
        # Test boolean array "contains" operator
        {"comparison_operator": "contains", "variable_selector": ["start", "bool_array"], "value": "true"},
        # Test boolean "in" operator
        {
            "comparison_operator": "in",
            "variable_selector": ["start", "bool_true"],
            "value": ["true", "false"],
        },
    ]
    return [Condition.model_validate(i) for i in conditions]


def _get_condition_test_id(c: Condition):
    return c.comparison_operator


@pytest.mark.parametrize("condition", _get_test_conditions(), ids=_get_condition_test_id)
def test_execute_if_else_boolean_conditions(condition: Condition):
    """Test IfElseNode with boolean conditions using various operators"""
    graph_config = {"edges": [], "nodes": [{"data": {"type": "start", "title": "Start"}, "id": "start"}]}

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

    # construct variable pool with boolean values
    pool = VariablePool(
        system_variables=SystemVariable(files=[], user_id="aaa"),
    )
    pool.add(["start", "bool_true"], True)
    pool.add(["start", "bool_false"], False)
    pool.add(["start", "bool_array"], [True, False, True])
    pool.add(["start", "mixed_array"], [True, "false", 1, 0])

    graph_runtime_state = GraphRuntimeState(variable_pool=pool, start_at=time.perf_counter())
    node_factory = DifyNodeFactory(
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )
    graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

    node_data = {
        "title": "Boolean Test",
        "type": "if-else",
        "logical_operator": "and",
        "conditions": [condition.model_dump()],
    }
    node = IfElseNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
        config={"id": "if-else", "data": node_data},
    )

    # Mock db.session.close()
    db.session.close = MagicMock()

    # execute node
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["result"] is True


def test_execute_if_else_boolean_false_conditions():
    """Test IfElseNode with boolean conditions that should evaluate to false"""
    graph_config = {"edges": [], "nodes": [{"data": {"type": "start", "title": "Start"}, "id": "start"}]}

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

    # construct variable pool with boolean values
    pool = VariablePool(
        system_variables=SystemVariable(files=[], user_id="aaa"),
    )
    pool.add(["start", "bool_true"], True)
    pool.add(["start", "bool_false"], False)
    pool.add(["start", "bool_array"], [True, False, True])

    graph_runtime_state = GraphRuntimeState(variable_pool=pool, start_at=time.perf_counter())
    node_factory = DifyNodeFactory(
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )
    graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

    node_data = {
        "title": "Boolean False Test",
        "type": "if-else",
        "logical_operator": "or",
        "conditions": [
            # Test boolean "is" operator (should be false)
            {"comparison_operator": "is", "variable_selector": ["start", "bool_true"], "value": "false"},
            # Test boolean "=" operator (should be false)
            {"comparison_operator": "=", "variable_selector": ["start", "bool_false"], "value": "1"},
            # Test boolean "not contains" operator (should be false)
            {
                "comparison_operator": "not contains",
                "variable_selector": ["start", "bool_array"],
                "value": "true",
            },
        ],
    }

    node = IfElseNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
        config={
            "id": "if-else",
            "data": node_data,
        },
    )

    # Mock db.session.close()
    db.session.close = MagicMock()

    # execute node
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["result"] is False


def test_execute_if_else_boolean_cases_structure():
    """Test IfElseNode with boolean conditions using the new cases structure"""
    graph_config = {"edges": [], "nodes": [{"data": {"type": "start", "title": "Start"}, "id": "start"}]}

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

    # construct variable pool with boolean values
    pool = VariablePool(
        system_variables=SystemVariable(files=[], user_id="aaa"),
    )
    pool.add(["start", "bool_true"], True)
    pool.add(["start", "bool_false"], False)

    graph_runtime_state = GraphRuntimeState(variable_pool=pool, start_at=time.perf_counter())
    node_factory = DifyNodeFactory(
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )
    graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

    node_data = {
        "title": "Boolean Cases Test",
        "type": "if-else",
        "cases": [
            {
                "case_id": "true",
                "logical_operator": "and",
                "conditions": [
                    {
                        "comparison_operator": "is",
                        "variable_selector": ["start", "bool_true"],
                        "value": "true",
                    },
                    {
                        "comparison_operator": "is not",
                        "variable_selector": ["start", "bool_false"],
                        "value": "true",
                    },
                ],
            }
        ],
    }
    node = IfElseNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
        config={"id": "if-else", "data": node_data},
    )

    # Mock db.session.close()
    db.session.close = MagicMock()

    # execute node
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["result"] is True
    assert result.outputs["selected_case_id"] == "true"
