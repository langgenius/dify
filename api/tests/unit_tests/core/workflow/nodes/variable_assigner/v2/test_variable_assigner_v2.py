import time
import uuid
from types import SimpleNamespace
from uuid import uuid4

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.workflow.node_factory import DifyNodeFactory
from core.variables import ArrayStringVariable, SegmentType
from core.workflow.entities import GraphInitParams
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.graph import Graph
from core.workflow.nodes.variable_assigner.v2 import VariableAssignerNode
from core.workflow.nodes.variable_assigner.v2.entities import VariableAssignerNodeData, VariableOperationItem
from core.workflow.nodes.variable_assigner.v2.enums import InputType, Operation
from core.workflow.nodes.variable_assigner.v2.exc import InvalidDataError
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom

DEFAULT_NODE_ID = "node_id"


def test_handle_item_directly():
    """Test the _handle_item method directly for remove operations."""
    # Create variables
    variable1 = ArrayStringVariable(
        id=str(uuid4()),
        name="test_variable1",
        value=["first", "second", "third"],
    )

    variable2 = ArrayStringVariable(
        id=str(uuid4()),
        name="test_variable2",
        value=["first", "second", "third"],
    )

    # Create a mock class with just the _handle_item method
    class MockNode:
        def _handle_item(self, *, variable, operation, value):
            match operation:
                case Operation.REMOVE_FIRST:
                    if not variable.value:
                        return variable.value
                    return variable.value[1:]
                case Operation.REMOVE_LAST:
                    if not variable.value:
                        return variable.value
                    return variable.value[:-1]

    node = MockNode()

    # Test remove-first
    result1 = node._handle_item(
        variable=variable1,
        operation=Operation.REMOVE_FIRST,
        value=None,
    )

    # Test remove-last
    result2 = node._handle_item(
        variable=variable2,
        operation=Operation.REMOVE_LAST,
        value=None,
    )

    # Check the results
    assert result1 == ["second", "third"]
    assert result2 == ["first", "second"]


def test_remove_first_from_array():
    """Test removing the first element from an array."""
    graph_config = {
        "edges": [
            {
                "id": "start-source-assigner-target",
                "source": "start",
                "target": "assigner",
            },
        ],
        "nodes": [
            {"data": {"type": "start", "title": "Start"}, "id": "start"},
            {
                "data": {"type": "assigner", "version": "2", "title": "Variable Assigner", "items": []},
                "id": "assigner",
            },
        ],
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

    conversation_variable = ArrayStringVariable(
        id=str(uuid4()),
        name="test_conversation_variable",
        value=["first", "second", "third"],
        selector=["conversation", "test_conversation_variable"],
    )

    variable_pool = VariablePool(
        system_variables=SystemVariable(conversation_id="conversation_id"),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[conversation_variable],
    )

    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())
    node_factory = DifyNodeFactory(
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )
    graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

    node_config = {
        "id": "node_id",
        "data": {
            "title": "test",
            "version": "2",
            "items": [
                {
                    "variable_selector": ["conversation", conversation_variable.name],
                    "input_type": InputType.VARIABLE,
                    "operation": Operation.REMOVE_FIRST,
                    "value": None,
                }
            ],
        },
    }

    node = VariableAssignerNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
        config=node_config,
    )

    # Run the node
    result = list(node.run())

    # Completed run

    got = variable_pool.get(["conversation", conversation_variable.name])
    assert got is not None
    assert got.to_object() == ["second", "third"]


def test_remove_last_from_array():
    """Test removing the last element from an array."""
    graph_config = {
        "edges": [
            {
                "id": "start-source-assigner-target",
                "source": "start",
                "target": "assigner",
            },
        ],
        "nodes": [
            {"data": {"type": "start", "title": "Start"}, "id": "start"},
            {
                "data": {"type": "assigner", "version": "2", "title": "Variable Assigner", "items": []},
                "id": "assigner",
            },
        ],
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

    conversation_variable = ArrayStringVariable(
        id=str(uuid4()),
        name="test_conversation_variable",
        value=["first", "second", "third"],
        selector=["conversation", "test_conversation_variable"],
    )

    variable_pool = VariablePool(
        system_variables=SystemVariable(conversation_id="conversation_id"),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[conversation_variable],
    )

    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())
    node_factory = DifyNodeFactory(
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )
    graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

    node_config = {
        "id": "node_id",
        "data": {
            "title": "test",
            "version": "2",
            "items": [
                {
                    "variable_selector": ["conversation", conversation_variable.name],
                    "input_type": InputType.VARIABLE,
                    "operation": Operation.REMOVE_LAST,
                    "value": None,
                }
            ],
        },
    }

    node = VariableAssignerNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
        config=node_config,
    )

    list(node.run())

    got = variable_pool.get(["conversation", conversation_variable.name])
    assert got is not None
    assert got.to_object() == ["first", "second"]


def test_remove_first_from_empty_array():
    """Test removing the first element from an empty array (should do nothing)."""
    graph_config = {
        "edges": [
            {
                "id": "start-source-assigner-target",
                "source": "start",
                "target": "assigner",
            },
        ],
        "nodes": [
            {"data": {"type": "start", "title": "Start"}, "id": "start"},
            {
                "data": {"type": "assigner", "version": "2", "title": "Variable Assigner", "items": []},
                "id": "assigner",
            },
        ],
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

    conversation_variable = ArrayStringVariable(
        id=str(uuid4()),
        name="test_conversation_variable",
        value=[],
        selector=["conversation", "test_conversation_variable"],
    )

    variable_pool = VariablePool(
        system_variables=SystemVariable(conversation_id="conversation_id"),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[conversation_variable],
    )

    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())
    node_factory = DifyNodeFactory(
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )
    graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

    node_config = {
        "id": "node_id",
        "data": {
            "title": "test",
            "version": "2",
            "items": [
                {
                    "variable_selector": ["conversation", conversation_variable.name],
                    "input_type": InputType.VARIABLE,
                    "operation": Operation.REMOVE_FIRST,
                    "value": None,
                }
            ],
        },
    }

    node = VariableAssignerNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
        config=node_config,
    )

    list(node.run())

    got = variable_pool.get(["conversation", conversation_variable.name])
    assert got is not None
    assert got.to_object() == []


def test_remove_last_from_empty_array():
    """Test removing the last element from an empty array (should do nothing)."""
    graph_config = {
        "edges": [
            {
                "id": "start-source-assigner-target",
                "source": "start",
                "target": "assigner",
            },
        ],
        "nodes": [
            {"data": {"type": "start", "title": "Start"}, "id": "start"},
            {
                "data": {"type": "assigner", "version": "2", "title": "Variable Assigner", "items": []},
                "id": "assigner",
            },
        ],
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

    conversation_variable = ArrayStringVariable(
        id=str(uuid4()),
        name="test_conversation_variable",
        value=[],
        selector=["conversation", "test_conversation_variable"],
    )

    variable_pool = VariablePool(
        system_variables=SystemVariable(conversation_id="conversation_id"),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[conversation_variable],
    )

    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())
    node_factory = DifyNodeFactory(
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )
    graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

    node_config = {
        "id": "node_id",
        "data": {
            "title": "test",
            "version": "2",
            "items": [
                {
                    "variable_selector": ["conversation", conversation_variable.name],
                    "input_type": InputType.VARIABLE,
                    "operation": Operation.REMOVE_LAST,
                    "value": None,
                }
            ],
        },
    }

    node = VariableAssignerNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
        config=node_config,
    )

    list(node.run())

    got = variable_pool.get(["conversation", conversation_variable.name])
    assert got is not None
    assert got.to_object() == []


def test_node_factory_creates_variable_assigner_node():
    graph_config = {
        "edges": [],
        "nodes": [
            {
                "data": {"type": "assigner", "version": "2", "title": "Variable Assigner", "items": []},
                "id": "assigner",
            },
        ],
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
    variable_pool = VariablePool(
        system_variables=SystemVariable(conversation_id="conversation_id"),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

    node_factory = DifyNodeFactory(
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )

    node = node_factory.create_node(graph_config["nodes"][0])

    assert isinstance(node, VariableAssignerNode)


def test_blocks_variable_output_matches_target_selector():
    node = VariableAssignerNode.__new__(VariableAssignerNode)
    node._node_data = SimpleNamespace(items=[SimpleNamespace(variable_selector=["conversation", "var_a"])])

    assert node.blocks_variable_output({("conversation", "var_a")}) is True
    assert node.blocks_variable_output({("conversation", "other")}) is False


def test_extract_variable_selector_to_variable_mapping_includes_target_and_source():
    mapping = VariableAssignerNode._extract_variable_selector_to_variable_mapping(
        graph_config={},
        node_id="node-x",
        node_data={
            "title": "assign",
            "version": "2",
            "items": [
                {
                    "variable_selector": ["conversation", "result"],
                    "input_type": InputType.VARIABLE,
                    "operation": Operation.OVER_WRITE,
                    "value": ["start", "value"],
                }
            ],
        },
    )

    assert mapping["node-x.#conversation.result#"] == ["conversation", "result"]
    assert mapping["node-x.#start.value#"] == ["start", "value"]


def test_extract_variable_selector_to_variable_mapping_raises_for_invalid_source_selector():
    with pytest.raises(InvalidDataError, match="selector is not a list"):
        VariableAssignerNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="node-x",
            node_data={
                "title": "assign",
                "version": "2",
                "items": [
                    {
                        "variable_selector": ["conversation", "result"],
                        "input_type": InputType.VARIABLE,
                        "operation": Operation.OVER_WRITE,
                        "value": "not-a-selector",
                    }
                ],
            },
        )


def test_handle_item_covers_all_arithmetic_and_collection_operations():
    node = VariableAssignerNode.__new__(VariableAssignerNode)
    numeric_variable = SimpleNamespace(value=10, value_type=SegmentType.NUMBER)
    array_variable = SimpleNamespace(value=[1, 2, 3], value_type=SegmentType.ARRAY_NUMBER)

    assert node._handle_item(variable=numeric_variable, operation=Operation.OVER_WRITE, value=99) == 99
    assert node._handle_item(variable=array_variable, operation=Operation.CLEAR, value=None) == []
    assert node._handle_item(variable=array_variable, operation=Operation.APPEND, value=4) == [1, 2, 3, 4]
    assert node._handle_item(variable=array_variable, operation=Operation.EXTEND, value=[4, 5]) == [1, 2, 3, 4, 5]
    assert node._handle_item(variable=numeric_variable, operation=Operation.SET, value=8) == 8
    assert node._handle_item(variable=numeric_variable, operation=Operation.ADD, value=5) == 15
    assert node._handle_item(variable=numeric_variable, operation=Operation.SUBTRACT, value=3) == 7
    assert node._handle_item(variable=numeric_variable, operation=Operation.MULTIPLY, value=2) == 20
    assert node._handle_item(variable=numeric_variable, operation=Operation.DIVIDE, value=2) == 5


def test_handle_item_remove_operations_keep_empty_array_unchanged():
    node = VariableAssignerNode.__new__(VariableAssignerNode)
    variable = SimpleNamespace(value=[])

    assert node._handle_item(variable=variable, operation=Operation.REMOVE_FIRST, value=None) == []
    assert node._handle_item(variable=variable, operation=Operation.REMOVE_LAST, value=None) == []


def test_run_returns_failed_when_target_variable_not_found():
    variable_pool = VariablePool.empty()
    node = VariableAssignerNode.__new__(VariableAssignerNode)
    node.graph_runtime_state = SimpleNamespace(variable_pool=variable_pool)
    node._node_data = VariableAssignerNodeData(
        title="assign",
        items=[
            VariableOperationItem(
                variable_selector=["conversation", "missing"],
                input_type=InputType.CONSTANT,
                operation=Operation.OVER_WRITE,
                value="value",
            )
        ],
    )

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert "not found" in (result.error or "").lower()


def test_run_returns_failed_when_json_input_is_invalid_for_object_set():
    variable_pool = VariablePool.empty()
    variable_pool.add(["conversation", "obj"], {})

    node = VariableAssignerNode.__new__(VariableAssignerNode)
    node.graph_runtime_state = SimpleNamespace(variable_pool=variable_pool)
    node._node_data = VariableAssignerNodeData(
        title="assign",
        items=[
            VariableOperationItem(
                variable_selector=["conversation", "obj"],
                input_type=InputType.CONSTANT,
                operation=Operation.SET,
                value="{invalid-json}",
            )
        ],
    )

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert "invalid input value" in (result.error or "").lower()
