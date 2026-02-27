import time
import uuid
from uuid import uuid4

from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.workflow.node_factory import DifyNodeFactory
from core.variables import ArrayStringVariable, StringVariable
from core.workflow.entities import GraphInitParams
from core.workflow.graph import Graph
from core.workflow.graph_events.node import NodeRunSucceededEvent
from core.workflow.nodes.variable_assigner.common import helpers as common_helpers
from core.workflow.nodes.variable_assigner.v1 import VariableAssignerNode
from core.workflow.nodes.variable_assigner.v1.node_data import WriteMode
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom

DEFAULT_NODE_ID = "node_id"


def test_overwrite_string_variable():
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
                "data": {
                    "type": "assigner",
                    "title": "Variable Assigner",
                    "assigned_variable_selector": ["conversation", "test_conversation_variable"],
                    "write_mode": "over-write",
                    "input_variable_selector": ["node_id", "test_string_variable"],
                },
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

    conversation_variable = StringVariable(
        id=str(uuid4()),
        name="test_conversation_variable",
        value="the first value",
    )

    input_variable = StringVariable(
        id=str(uuid4()),
        name="test_string_variable",
        value="the second value",
    )
    conversation_id = str(uuid.uuid4())

    # construct variable pool
    variable_pool = VariablePool(
        system_variables=SystemVariable(conversation_id=conversation_id),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[conversation_variable],
    )

    variable_pool.add(
        [DEFAULT_NODE_ID, input_variable.name],
        input_variable,
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
            "assigned_variable_selector": ["conversation", conversation_variable.name],
            "write_mode": WriteMode.OVER_WRITE,
            "input_variable_selector": [DEFAULT_NODE_ID, input_variable.name],
        },
    }

    node = VariableAssignerNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
        config=node_config,
    )

    events = list(node.run())
    succeeded_event = next(event for event in events if isinstance(event, NodeRunSucceededEvent))
    updated_variables = common_helpers.get_updated_variables(succeeded_event.node_run_result.process_data)
    assert updated_variables is not None
    assert updated_variables[0].name == conversation_variable.name
    assert updated_variables[0].new_value == input_variable.value

    got = variable_pool.get(["conversation", conversation_variable.name])
    assert got is not None
    assert got.value == "the second value"
    assert got.to_object() == "the second value"


def test_append_variable_to_array():
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
                "data": {
                    "type": "assigner",
                    "title": "Variable Assigner",
                    "assigned_variable_selector": ["conversation", "test_conversation_variable"],
                    "write_mode": "append",
                    "input_variable_selector": ["node_id", "test_string_variable"],
                },
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
        value=["the first value"],
    )

    input_variable = StringVariable(
        id=str(uuid4()),
        name="test_string_variable",
        value="the second value",
    )
    conversation_id = str(uuid.uuid4())

    variable_pool = VariablePool(
        system_variables=SystemVariable(conversation_id=conversation_id),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[conversation_variable],
    )
    variable_pool.add(
        [DEFAULT_NODE_ID, input_variable.name],
        input_variable,
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
            "assigned_variable_selector": ["conversation", conversation_variable.name],
            "write_mode": WriteMode.APPEND,
            "input_variable_selector": [DEFAULT_NODE_ID, input_variable.name],
        },
    }

    node = VariableAssignerNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
        config=node_config,
    )

    events = list(node.run())
    succeeded_event = next(event for event in events if isinstance(event, NodeRunSucceededEvent))
    updated_variables = common_helpers.get_updated_variables(succeeded_event.node_run_result.process_data)
    assert updated_variables is not None
    assert updated_variables[0].name == conversation_variable.name
    assert updated_variables[0].new_value == ["the first value", "the second value"]

    got = variable_pool.get(["conversation", conversation_variable.name])
    assert got is not None
    assert got.to_object() == ["the first value", "the second value"]


def test_clear_array():
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
                "data": {
                    "type": "assigner",
                    "title": "Variable Assigner",
                    "assigned_variable_selector": ["conversation", "test_conversation_variable"],
                    "write_mode": "clear",
                    "input_variable_selector": [],
                },
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
        value=["the first value"],
    )

    conversation_id = str(uuid.uuid4())
    variable_pool = VariablePool(
        system_variables=SystemVariable(conversation_id=conversation_id),
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
            "assigned_variable_selector": ["conversation", conversation_variable.name],
            "write_mode": WriteMode.CLEAR,
            "input_variable_selector": [],
        },
    }

    node = VariableAssignerNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
        config=node_config,
    )

    events = list(node.run())
    succeeded_event = next(event for event in events if isinstance(event, NodeRunSucceededEvent))
    updated_variables = common_helpers.get_updated_variables(succeeded_event.node_run_result.process_data)
    assert updated_variables is not None
    assert updated_variables[0].name == conversation_variable.name
    assert updated_variables[0].new_value == []

    got = variable_pool.get(["conversation", conversation_variable.name])
    assert got is not None
    assert got.to_object() == []
