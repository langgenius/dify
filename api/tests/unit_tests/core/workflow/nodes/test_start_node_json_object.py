import json
import time

import pytest
from graphon.nodes.start.entities import StartNodeData
from graphon.nodes.start.start_node import StartNode
from graphon.runtime import GraphRuntimeState
from graphon.variables import build_segment, segment_to_variable
from graphon.variables.input_entities import VariableEntity, VariableEntityType
from graphon.variables.variables import Variable
from pydantic import ValidationError as PydanticValidationError

from core.workflow.system_variables import build_system_variables
from core.workflow.variable_prefixes import CONVERSATION_VARIABLE_NODE_ID, ENVIRONMENT_VARIABLE_NODE_ID
from tests.workflow_test_utils import build_test_graph_init_params, build_test_variable_pool


def make_start_node(user_inputs, variables):
    variable_pool = build_test_variable_pool(
        variables=build_system_variables(),
        node_id="start",
        inputs=user_inputs,
    )

    config = {
        "id": "start",
        "data": StartNodeData(title="Start", variables=variables).model_dump(),
    }

    graph_runtime_state = GraphRuntimeState(
        variable_pool=variable_pool,
        start_at=time.perf_counter(),
    )

    return StartNode(
        id="start",
        config=config,
        graph_init_params=build_test_graph_init_params(
            workflow_id="wf",
            graph_config={},
            tenant_id="tenant",
            app_id="app",
            user_id="u",
            user_from="account",
            invoke_from="debugger",
            call_depth=0,
        ),
        graph_runtime_state=graph_runtime_state,
    )


def test_json_object_valid_schema():
    schema = json.dumps(
        {
            "type": "object",
            "properties": {
                "age": {"type": "number"},
                "name": {"type": "string"},
            },
            "required": ["age"],
        }
    )

    schema = json.loads(schema)

    variables = [
        VariableEntity(
            variable="profile",
            label="profile",
            type=VariableEntityType.JSON_OBJECT,
            required=True,
            json_schema=schema,
        )
    ]

    user_inputs = {"profile": {"age": 20, "name": "Tom"}}

    node = make_start_node(user_inputs, variables)
    result = node._run()

    assert result.outputs["profile"] == {"age": 20, "name": "Tom"}


def test_json_object_invalid_json_string():
    schema = json.dumps(
        {
            "type": "object",
            "properties": {
                "age": {"type": "number"},
                "name": {"type": "string"},
            },
            "required": ["age", "name"],
        }
    )

    schema = json.loads(schema)
    variables = [
        VariableEntity(
            variable="profile",
            label="profile",
            type=VariableEntityType.JSON_OBJECT,
            required=True,
            json_schema=schema,
        )
    ]

    # Providing a string instead of an object should raise a type error
    user_inputs = {"profile": '{"age": 20, "name": "Tom"'}

    node = make_start_node(user_inputs, variables)

    with pytest.raises(ValueError, match="JSON object for 'profile' must be an object"):
        node._run()


def test_json_object_does_not_match_schema():
    schema = json.dumps(
        {
            "type": "object",
            "properties": {
                "age": {"type": "number"},
                "name": {"type": "string"},
            },
            "required": ["age", "name"],
        }
    )

    schema = json.loads(schema)

    variables = [
        VariableEntity(
            variable="profile",
            label="profile",
            type=VariableEntityType.JSON_OBJECT,
            required=True,
            json_schema=schema,
        )
    ]

    # age is a string, which violates the schema (expects number)
    user_inputs = {"profile": {"age": "twenty", "name": "Tom"}}

    node = make_start_node(user_inputs, variables)

    with pytest.raises(ValueError, match=r"JSON object for 'profile' does not match schema:"):
        node._run()


def test_json_object_missing_required_schema_field():
    schema = json.dumps(
        {
            "type": "object",
            "properties": {
                "age": {"type": "number"},
                "name": {"type": "string"},
            },
            "required": ["age", "name"],
        }
    )

    schema = json.loads(schema)

    variables = [
        VariableEntity(
            variable="profile",
            label="profile",
            type=VariableEntityType.JSON_OBJECT,
            required=True,
            json_schema=schema,
        )
    ]

    # Missing required field "name"
    user_inputs = {"profile": {"age": 20}}

    node = make_start_node(user_inputs, variables)

    with pytest.raises(
        ValueError, match=r"JSON object for 'profile' does not match schema: 'name' is a required property"
    ):
        node._run()


def test_json_object_required_variable_missing_from_inputs():
    variables = [
        VariableEntity(
            variable="profile",
            label="profile",
            type=VariableEntityType.JSON_OBJECT,
            required=True,
        )
    ]

    user_inputs = {}

    node = make_start_node(user_inputs, variables)

    with pytest.raises(ValueError, match="profile is required in input form"):
        node._run()


def test_json_object_invalid_json_schema_string():
    variable = VariableEntity(
        variable="profile",
        label="profile",
        type=VariableEntityType.JSON_OBJECT,
        required=True,
    )

    # Bypass pydantic type validation on assignment to simulate an invalid JSON schema string
    variable.json_schema = "{invalid-json-schema"

    variables = [variable]
    user_inputs = {"profile": '{"age": 20}'}

    # Invalid json_schema string should be rejected during node data hydration
    with pytest.raises(PydanticValidationError):
        make_start_node(user_inputs, variables)


def test_json_object_optional_variable_not_provided():
    variables = [
        VariableEntity(
            variable="profile",
            label="profile",
            type=VariableEntityType.JSON_OBJECT,
            required=True,
        )
    ]

    user_inputs = {}

    node = make_start_node(user_inputs, variables)

    # Current implementation raises a validation error even when the variable is optional
    with pytest.raises(ValueError, match="profile is required in input form"):
        node._run()


def test_start_node_outputs_full_variable_pool_snapshot():
    variable_pool = build_test_variable_pool(
        variables=[
            *build_system_variables(query="hello", workflow_run_id="run-123"),
            _build_prefixed_variable(ENVIRONMENT_VARIABLE_NODE_ID, "API_KEY", "secret"),
            _build_prefixed_variable(CONVERSATION_VARIABLE_NODE_ID, "session_id", "conversation-1"),
        ],
        node_id="start",
        inputs={"profile": {"age": 20, "name": "Tom"}},
    )

    config = {
        "id": "start",
        "data": StartNodeData(
            title="Start",
            variables=[
                VariableEntity(
                    variable="profile",
                    label="profile",
                    type=VariableEntityType.JSON_OBJECT,
                    required=True,
                )
            ],
        ).model_dump(),
    }

    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())
    node = StartNode(
        id="start",
        config=config,
        graph_init_params=build_test_graph_init_params(
            workflow_id="wf",
            graph_config={},
            tenant_id="tenant",
            app_id="app",
            user_id="u",
            user_from="account",
            invoke_from="debugger",
            call_depth=0,
        ),
        graph_runtime_state=graph_runtime_state,
    )

    result = node._run()

    assert result.inputs == {"profile": {"age": 20, "name": "Tom"}}
    assert result.outputs["profile"] == {"age": 20, "name": "Tom"}
    assert result.outputs["sys.query"] == "hello"
    assert result.outputs["sys.workflow_run_id"] == "run-123"
    assert result.outputs["env.API_KEY"] == "secret"
    assert result.outputs["conversation.session_id"] == "conversation-1"


def _build_prefixed_variable(node_id: str, name: str, value: object) -> Variable:
    return segment_to_variable(
        segment=build_segment(value),
        selector=(node_id, name),
        name=name,
    )
