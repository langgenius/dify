import time
import uuid
from unittest import mock
from uuid import uuid4

from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.segments import ArrayStringVariable, StringVariable
from core.workflow.entities.node_entities import UserFrom
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariableKey
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.graph_init_params import GraphInitParams
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.nodes.variable_assigner import VariableAssignerNode, WriteMode
from models.workflow import WorkflowType

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
            {"data": {"type": "start"}, "id": "start"},
            {
                "data": {
                    "type": "assigner",
                },
                "id": "assigner",
            },
        ],
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

    # construct variable pool
    variable_pool = VariablePool(
        system_variables={SystemVariableKey.CONVERSATION_ID: "conversation_id"},
        user_inputs={},
        environment_variables=[],
        conversation_variables=[conversation_variable],
    )

    variable_pool.add(
        [DEFAULT_NODE_ID, input_variable.name],
        input_variable,
    )

    node = VariableAssignerNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph=graph,
        graph_runtime_state=GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter()),
        config={
            "id": "node_id",
            "data": {
                "assigned_variable_selector": ["conversation", conversation_variable.name],
                "write_mode": WriteMode.OVER_WRITE.value,
                "input_variable_selector": [DEFAULT_NODE_ID, input_variable.name],
            },
        },
    )

    with mock.patch("core.workflow.nodes.variable_assigner.node.update_conversation_variable") as mock_run:
        list(node.run())
        mock_run.assert_called_once()

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
            {"data": {"type": "start"}, "id": "start"},
            {
                "data": {
                    "type": "assigner",
                },
                "id": "assigner",
            },
        ],
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

    variable_pool = VariablePool(
        system_variables={SystemVariableKey.CONVERSATION_ID: "conversation_id"},
        user_inputs={},
        environment_variables=[],
        conversation_variables=[conversation_variable],
    )
    variable_pool.add(
        [DEFAULT_NODE_ID, input_variable.name],
        input_variable,
    )

    node = VariableAssignerNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph=graph,
        graph_runtime_state=GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter()),
        config={
            "id": "node_id",
            "data": {
                "assigned_variable_selector": ["conversation", conversation_variable.name],
                "write_mode": WriteMode.APPEND.value,
                "input_variable_selector": [DEFAULT_NODE_ID, input_variable.name],
            },
        },
    )

    with mock.patch("core.workflow.nodes.variable_assigner.node.update_conversation_variable") as mock_run:
        list(node.run())
        mock_run.assert_called_once()

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
            {"data": {"type": "start"}, "id": "start"},
            {
                "data": {
                    "type": "assigner",
                },
                "id": "assigner",
            },
        ],
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

    conversation_variable = ArrayStringVariable(
        id=str(uuid4()),
        name="test_conversation_variable",
        value=["the first value"],
    )

    variable_pool = VariablePool(
        system_variables={SystemVariableKey.CONVERSATION_ID: "conversation_id"},
        user_inputs={},
        environment_variables=[],
        conversation_variables=[conversation_variable],
    )

    node = VariableAssignerNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph=graph,
        graph_runtime_state=GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter()),
        config={
            "id": "node_id",
            "data": {
                "assigned_variable_selector": ["conversation", conversation_variable.name],
                "write_mode": WriteMode.CLEAR.value,
                "input_variable_selector": [],
            },
        },
    )

    with mock.patch("core.workflow.nodes.variable_assigner.node.update_conversation_variable") as mock_run:
        list(node.run())
        mock_run.assert_called_once()

    got = variable_pool.get(["conversation", conversation_variable.name])
    assert got is not None
    assert got.to_object() == []
