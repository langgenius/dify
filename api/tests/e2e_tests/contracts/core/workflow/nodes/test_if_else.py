import time
import uuid
from unittest.mock import Mock

import pytest

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, InvokeFrom, UserFrom
from core.workflow.graph_config import WorkflowGraphConfigDict
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.system_variables import build_system_variables
from graphon.entities.graph_config import NodeConfigDict
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.file import File, FileTransferMethod, FileType
from graphon.graph import Graph
from graphon.nodes.if_else.entities import IfElseNodeData
from graphon.nodes.if_else.if_else_node import IfElseNode
from graphon.nodes.start.entities import StartNodeData
from graphon.runtime import InitParams, RuntimeState, VariablePool
from graphon.utils.condition.entities import Condition, SubCondition, SubVariableCondition
from graphon.variables import ArrayFileSegment
from tests.workflow_test_utils import build_test_graph_init_params


def _start_graph_config() -> WorkflowGraphConfigDict:
    """A graph holding only the start node, which is all an if-else node needs to resolve variables."""
    return WorkflowGraphConfigDict(
        nodes=[NodeConfigDict(id="start", data=StartNodeData(type=BuiltinNodeTypes.START, title="Start"))],
        edges=[],
    )


def _build_if_else_node(
    *,
    node_data: IfElseNodeData,
    init_params: InitParams,
    runtime_state: RuntimeState,
) -> IfElseNode:
    return IfElseNode(
        node_id=str(uuid.uuid4()),
        init_params=init_params,
        runtime_state=runtime_state,
        data=node_data,
    )


def test_execute_if_else_result_true() -> None:
    graph_config = _start_graph_config()

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
    pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(user_id="aaa", files=[]),
        user_inputs={},
    )
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

    graph_runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=pool, start_at=time.perf_counter())
    node_factory = DifyNodeFactory(
        init_params=init_params,
        runtime_state=graph_runtime_state,
    )
    Graph.init(graph_config=graph_config, node_factory=node_factory, root_node_id="start")

    node = _build_if_else_node(
        node_data=IfElseNodeData(
            title="123",
            logical_operator="and",
            conditions=[
                Condition(
                    comparison_operator="contains",
                    variable_selector=["start", "array_contains"],
                    value="ab",
                ),
                Condition(
                    comparison_operator="not contains",
                    variable_selector=["start", "array_not_contains"],
                    value="ab",
                ),
                Condition(comparison_operator="contains", variable_selector=["start", "contains"], value="ab"),
                Condition(
                    comparison_operator="not contains",
                    variable_selector=["start", "not_contains"],
                    value="ab",
                ),
                Condition(comparison_operator="start with", variable_selector=["start", "start_with"], value="ab"),
                Condition(comparison_operator="end with", variable_selector=["start", "end_with"], value="ab"),
                Condition(comparison_operator="is", variable_selector=["start", "is"], value="ab"),
                Condition(comparison_operator="is not", variable_selector=["start", "is_not"], value="ab"),
                Condition(comparison_operator="empty", variable_selector=["start", "empty"], value="ab"),
                Condition(comparison_operator="not empty", variable_selector=["start", "not_empty"], value="ab"),
                Condition(comparison_operator="=", variable_selector=["start", "equals"], value="22"),
                Condition(comparison_operator="≠", variable_selector=["start", "not_equals"], value="22"),
                Condition(comparison_operator=">", variable_selector=["start", "greater_than"], value="22"),
                Condition(comparison_operator="<", variable_selector=["start", "less_than"], value="22"),
                Condition(
                    comparison_operator="≥",
                    variable_selector=["start", "greater_than_or_equal"],
                    value="22",
                ),
                Condition(comparison_operator="≤", variable_selector=["start", "less_than_or_equal"], value="22"),
                Condition(comparison_operator="null", variable_selector=["start", "null"]),
                Condition(comparison_operator="not null", variable_selector=["start", "not_null"]),
            ],
        ),
        init_params=init_params,
        runtime_state=graph_runtime_state,
    )

    # execute node
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["result"] is True


def test_execute_if_else_result_false() -> None:
    # Create a simple graph for IfElse node testing
    graph_config = _start_graph_config()

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
    pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(user_id="aaa", files=[]),
        user_inputs={},
        environment_variables=[],
    )
    pool.add(["start", "array_contains"], ["1ab", "def"])
    pool.add(["start", "array_not_contains"], ["ab", "def"])

    graph_runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=pool, start_at=time.perf_counter())
    node_factory = DifyNodeFactory(
        init_params=init_params,
        runtime_state=graph_runtime_state,
    )
    Graph.init(graph_config=graph_config, node_factory=node_factory, root_node_id="start")

    node = _build_if_else_node(
        node_data=IfElseNodeData(
            title="123",
            logical_operator="or",
            conditions=[
                Condition(
                    comparison_operator="contains",
                    variable_selector=["start", "array_contains"],
                    value="ab",
                ),
                Condition(
                    comparison_operator="not contains",
                    variable_selector=["start", "array_not_contains"],
                    value="ab",
                ),
            ],
        ),
        init_params=init_params,
        runtime_state=graph_runtime_state,
    )

    # execute node
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["result"] is False


def test_array_file_contains_file_name() -> None:
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

    # Create properly configured mock for graph_init_params
    graph_init_params = Mock()
    graph_init_params.workflow_id = "test_workflow"
    graph_init_params.graph_config = WorkflowGraphConfigDict(nodes=[], edges=[])
    graph_init_params.call_depth = 0
    graph_init_params.run_context = {
        DIFY_RUN_CONTEXT_KEY: {
            "tenant_id": "test_tenant",
            "app_id": "test_app",
            "user_id": "test_user",
            "user_from": UserFrom.ACCOUNT,
            "invoke_from": InvokeFrom.SERVICE_API,
        }
    }

    node = _build_if_else_node(node_data=node_data, init_params=graph_init_params, runtime_state=Mock())

    get_selector = node.runtime_state.variable_pool.get
    assert isinstance(get_selector, Mock)
    get_selector.return_value = ArrayFileSegment(
        value=[
            File(
                file_type=FileType.IMAGE,
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


def _get_test_conditions() -> list[Condition]:
    return [
        # Test boolean "is" operator
        Condition(comparison_operator="is", variable_selector=["start", "bool_true"], value="true"),
        # Test boolean "is not" operator
        Condition(comparison_operator="is not", variable_selector=["start", "bool_false"], value="true"),
        # Test boolean "=" operator
        Condition(comparison_operator="=", variable_selector=["start", "bool_true"], value="1"),
        # Test boolean "≠" operator
        Condition(comparison_operator="≠", variable_selector=["start", "bool_false"], value="1"),
        # Test boolean "not null" operator
        Condition(comparison_operator="not null", variable_selector=["start", "bool_true"]),
        # Test boolean array "contains" operator
        Condition(comparison_operator="contains", variable_selector=["start", "bool_array"], value="true"),
        # Test boolean "in" operator
        Condition(
            comparison_operator="in",
            variable_selector=["start", "bool_true"],
            value=["true", "false"],
        ),
    ]


def _get_condition_test_id(c: Condition) -> str:
    return c.comparison_operator


@pytest.mark.parametrize("condition", _get_test_conditions(), ids=_get_condition_test_id)
def test_execute_if_else_boolean_conditions(condition: Condition) -> None:
    """Test IfElseNode with boolean conditions using various operators"""
    graph_config = _start_graph_config()

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

    # construct variable pool with boolean values
    pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(files=[], user_id="aaa"),
    )
    pool.add(["start", "bool_true"], True)
    pool.add(["start", "bool_false"], False)
    pool.add(["start", "bool_array"], [True, False, True])
    pool.add(["start", "mixed_array"], [True, "false", 1, 0])

    graph_runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=pool, start_at=time.perf_counter())
    node_factory = DifyNodeFactory(
        init_params=init_params,
        runtime_state=graph_runtime_state,
    )
    Graph.init(graph_config=graph_config, node_factory=node_factory, root_node_id="start")

    node_data = IfElseNodeData(
        title="Boolean Test",
        logical_operator="and",
        conditions=[condition],
    )
    node = _build_if_else_node(
        node_data=node_data,
        init_params=init_params,
        runtime_state=graph_runtime_state,
    )

    # execute node
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["result"] is True


def test_execute_if_else_boolean_false_conditions() -> None:
    """Test IfElseNode with boolean conditions that should evaluate to false"""
    graph_config = _start_graph_config()

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

    # construct variable pool with boolean values
    pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(files=[], user_id="aaa"),
    )
    pool.add(["start", "bool_true"], True)
    pool.add(["start", "bool_false"], False)
    pool.add(["start", "bool_array"], [True, False, True])

    graph_runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=pool, start_at=time.perf_counter())
    node_factory = DifyNodeFactory(
        init_params=init_params,
        runtime_state=graph_runtime_state,
    )
    Graph.init(graph_config=graph_config, node_factory=node_factory, root_node_id="start")

    node_data = IfElseNodeData(
        title="Boolean False Test",
        logical_operator="or",
        conditions=[
            # Test boolean "is" operator (should be false)
            Condition(comparison_operator="is", variable_selector=["start", "bool_true"], value="false"),
            # Test boolean "=" operator (should be false)
            Condition(comparison_operator="=", variable_selector=["start", "bool_false"], value="1"),
            # Test boolean "not contains" operator (should be false)
            Condition(
                comparison_operator="not contains",
                variable_selector=["start", "bool_array"],
                value="true",
            ),
        ],
    )

    node = _build_if_else_node(
        node_data=node_data,
        init_params=init_params,
        runtime_state=graph_runtime_state,
    )

    # execute node
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["result"] is False


def test_execute_if_else_boolean_cases_structure() -> None:
    """Test IfElseNode with boolean conditions using the new cases structure"""
    graph_config = _start_graph_config()

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

    # construct variable pool with boolean values
    pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(files=[], user_id="aaa"),
    )
    pool.add(["start", "bool_true"], True)
    pool.add(["start", "bool_false"], False)

    graph_runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=pool, start_at=time.perf_counter())
    node_factory = DifyNodeFactory(
        init_params=init_params,
        runtime_state=graph_runtime_state,
    )
    Graph.init(graph_config=graph_config, node_factory=node_factory, root_node_id="start")

    node_data = IfElseNodeData(
        title="Boolean Cases Test",
        cases=[
            IfElseNodeData.Case(
                case_id="true",
                logical_operator="and",
                conditions=[
                    Condition(
                        comparison_operator="is",
                        variable_selector=["start", "bool_true"],
                        value="true",
                    ),
                    Condition(
                        comparison_operator="is not",
                        variable_selector=["start", "bool_false"],
                        value="true",
                    ),
                ],
            )
        ],
    )
    node = _build_if_else_node(
        node_data=node_data,
        init_params=init_params,
        runtime_state=graph_runtime_state,
    )

    # execute node
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["result"] is True
    assert result.outputs["selected_case_id"] == "true"
