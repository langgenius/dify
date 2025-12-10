import time

import pytest
from pydantic import ValidationError as PydanticValidationError

from core.app.app_config.entities import VariableEntity, VariableEntityType
from core.workflow.entities import GraphInitParams
from core.workflow.nodes.start.entities import StartNodeData
from core.workflow.nodes.start.start_node import StartNode
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable


def make_start_node(user_inputs, variables):
    variable_pool = VariablePool(
        system_variables=SystemVariable(),
        user_inputs=user_inputs,
        conversation_variables=[],
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
        graph_init_params=GraphInitParams(
            tenant_id="tenant",
            app_id="app",
            workflow_id="wf",
            graph_config={},
            user_id="u",
            user_from="account",
            invoke_from="debugger",
            call_depth=0,
        ),
        graph_runtime_state=graph_runtime_state,
    )


def test_json_object_valid_schema():
    schema = {
        "type": "object",
        "properties": {
            "age": {"type": "number"},
            "name": {"type": "string"},
        },
        "required": ["age"],
    }

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
    variables = [
        VariableEntity(
            variable="profile",
            label="profile",
            type=VariableEntityType.JSON_OBJECT,
            required=True,
        )
    ]

    # Missing closing brace makes this invalid JSON
    user_inputs = {"profile": '{"age": 20, "name": "Tom"'}

    node = make_start_node(user_inputs, variables)

    with pytest.raises(ValueError, match="profile must be a JSON object"):
        node._run()


@pytest.mark.parametrize("value", ["[1, 2, 3]", "123"])
def test_json_object_valid_json_but_not_object(value):
    variables = [
        VariableEntity(
            variable="profile",
            label="profile",
            type=VariableEntityType.JSON_OBJECT,
            required=True,
        )
    ]

    user_inputs = {"profile": value}

    node = make_start_node(user_inputs, variables)

    with pytest.raises(ValueError, match="profile must be a JSON object"):
        node._run()


def test_json_object_does_not_match_schema():
    schema = {
        "type": "object",
        "properties": {
            "age": {"type": "number"},
            "name": {"type": "string"},
        },
        "required": ["age", "name"],
    }

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
    schema = {
        "type": "object",
        "properties": {
            "age": {"type": "number"},
            "name": {"type": "string"},
        },
        "required": ["age", "name"],
    }

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
            required=False,
        )
    ]

    user_inputs = {}

    node = make_start_node(user_inputs, variables)

    # Current implementation raises a validation error even when the variable is optional
    with pytest.raises(ValueError, match="profile must be a JSON object"):
        node._run()
