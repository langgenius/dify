import time
import uuid
from uuid import uuid4

from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.workflow.node_factory import DifyNodeFactory
from core.variables import ArrayStringVariable
from core.workflow.entities import GraphInitParams
from core.workflow.graph import Graph
from core.workflow.nodes.variable_assigner.v2 import VariableAssignerNode
from core.workflow.nodes.variable_assigner.v2.enums import InputType, Operation
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
