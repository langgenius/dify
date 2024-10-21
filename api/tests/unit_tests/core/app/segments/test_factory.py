from uuid import uuid4

import pytest

from core.variables import (
    ArrayNumberVariable,
    ArrayObjectVariable,
    ArrayStringVariable,
    FloatVariable,
    IntegerVariable,
    ObjectSegment,
    SecretVariable,
    StringVariable,
)
from core.variables.exc import VariableError
from factories import variable_factory


def test_string_variable():
    test_data = {"value_type": "string", "name": "test_text", "value": "Hello, World!"}
    result = variable_factory.build_variable_from_mapping(test_data)
    assert isinstance(result, StringVariable)


def test_integer_variable():
    test_data = {"value_type": "number", "name": "test_int", "value": 42}
    result = variable_factory.build_variable_from_mapping(test_data)
    assert isinstance(result, IntegerVariable)


def test_float_variable():
    test_data = {"value_type": "number", "name": "test_float", "value": 3.14}
    result = variable_factory.build_variable_from_mapping(test_data)
    assert isinstance(result, FloatVariable)


def test_secret_variable():
    test_data = {"value_type": "secret", "name": "test_secret", "value": "secret_value"}
    result = variable_factory.build_variable_from_mapping(test_data)
    assert isinstance(result, SecretVariable)


def test_invalid_value_type():
    test_data = {"value_type": "unknown", "name": "test_invalid", "value": "value"}
    with pytest.raises(VariableError):
        variable_factory.build_variable_from_mapping(test_data)


def test_build_a_blank_string():
    result = variable_factory.build_variable_from_mapping(
        {
            "value_type": "string",
            "name": "blank",
            "value": "",
        }
    )
    assert isinstance(result, StringVariable)
    assert result.value == ""


def test_build_a_object_variable_with_none_value():
    var = variable_factory.build_segment(
        {
            "key1": None,
        }
    )
    assert isinstance(var, ObjectSegment)
    assert var.value["key1"] is None


def test_object_variable():
    mapping = {
        "id": str(uuid4()),
        "value_type": "object",
        "name": "test_object",
        "description": "Description of the variable.",
        "value": {
            "key1": "text",
            "key2": 2,
        },
    }
    variable = variable_factory.build_variable_from_mapping(mapping)
    assert isinstance(variable, ObjectSegment)
    assert isinstance(variable.value["key1"], str)
    assert isinstance(variable.value["key2"], int)


def test_array_string_variable():
    mapping = {
        "id": str(uuid4()),
        "value_type": "array[string]",
        "name": "test_array",
        "description": "Description of the variable.",
        "value": [
            "text",
            "text",
        ],
    }
    variable = variable_factory.build_variable_from_mapping(mapping)
    assert isinstance(variable, ArrayStringVariable)
    assert isinstance(variable.value[0], str)
    assert isinstance(variable.value[1], str)


def test_array_number_variable():
    mapping = {
        "id": str(uuid4()),
        "value_type": "array[number]",
        "name": "test_array",
        "description": "Description of the variable.",
        "value": [
            1,
            2.0,
        ],
    }
    variable = variable_factory.build_variable_from_mapping(mapping)
    assert isinstance(variable, ArrayNumberVariable)
    assert isinstance(variable.value[0], int)
    assert isinstance(variable.value[1], float)


def test_array_object_variable():
    mapping = {
        "id": str(uuid4()),
        "value_type": "array[object]",
        "name": "test_array",
        "description": "Description of the variable.",
        "value": [
            {
                "key1": "text",
                "key2": 1,
            },
            {
                "key1": "text",
                "key2": 1,
            },
        ],
    }
    variable = variable_factory.build_variable_from_mapping(mapping)
    assert isinstance(variable, ArrayObjectVariable)
    assert isinstance(variable.value[0], dict)
    assert isinstance(variable.value[1], dict)
    assert isinstance(variable.value[0]["key1"], str)
    assert isinstance(variable.value[0]["key2"], int)
    assert isinstance(variable.value[1]["key1"], str)
    assert isinstance(variable.value[1]["key2"], int)


def test_variable_cannot_large_than_200_kb():
    with pytest.raises(VariableError):
        variable_factory.build_variable_from_mapping(
            {
                "id": str(uuid4()),
                "value_type": "string",
                "name": "test_text",
                "value": "a" * 1024 * 201,
            }
        )
