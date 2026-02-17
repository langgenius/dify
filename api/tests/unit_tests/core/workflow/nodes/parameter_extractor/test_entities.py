import pytest
from pydantic import ValidationError

from core.variables.types import SegmentType
from core.workflow.nodes.parameter_extractor.entities import (
    ParameterConfig,
    ParameterExtractorNodeData,
    _validate_type,
)

# ============================================================
# Fixtures
# ============================================================


@pytest.fixture
def base_parameter():
    return {
        "name": "age",
        "type": SegmentType.NUMBER,
        "description": "User age",
        "required": True,
    }


@pytest.fixture
def string_parameter():
    return {
        "name": "username",
        "type": SegmentType.STRING,
        "description": "User name",
        "required": False,
    }


@pytest.fixture
def array_string_parameter():
    return {
        "name": "tags",
        "type": SegmentType.ARRAY_STRING,
        "description": "User tags",
        "required": True,
    }


@pytest.fixture
def build_node():
    def _build(parameters, reasoning_mode="function_call"):
        return ParameterExtractorNodeData.model_construct(
            title="test-node",
            model=None,
            query=["test"],
            parameters=parameters,
            instruction=None,
            memory=None,
            reasoning_mode=reasoning_mode,
            vision=None,
        )

    return _build


# ============================================================
# _validate_type Tests
# ============================================================


@pytest.mark.parametrize(
    ("input_type", "expected"),
    [
        (SegmentType.STRING, SegmentType.STRING),
        (SegmentType.NUMBER, SegmentType.NUMBER),
        (SegmentType.BOOLEAN, SegmentType.BOOLEAN),
        ("bool", SegmentType.BOOLEAN),
        ("select", SegmentType.STRING),
    ],
)
def test_validate_type_valid(input_type, expected):
    assert _validate_type(input_type) == expected


@pytest.mark.parametrize("invalid_type", ["invalid", "", None, 123])
def test_validate_type_invalid(invalid_type):
    with pytest.raises(ValueError):
        _validate_type(invalid_type)


# ============================================================
# ParameterConfig Tests
# ============================================================


def test_parameter_config_valid_creation(base_parameter):
    param = ParameterConfig(**base_parameter)
    assert param.name == "age"
    assert param.type == SegmentType.NUMBER
    assert param.required is True
    assert param.options is None


@pytest.mark.parametrize("invalid_name", ["", None])
def test_parameter_config_invalid_name_required(invalid_name, base_parameter):
    base_parameter["name"] = invalid_name
    with pytest.raises(ValidationError):
        ParameterConfig(**base_parameter)


@pytest.mark.parametrize("reserved_name", ["__reason", "__is_success"])
def test_parameter_config_reserved_name(reserved_name, base_parameter):
    base_parameter["name"] = reserved_name
    with pytest.raises(ValidationError):
        ParameterConfig(**base_parameter)


def test_parameter_config_old_bool_conversion(base_parameter):
    base_parameter["type"] = "bool"
    param = ParameterConfig(**base_parameter)
    assert param.type == SegmentType.BOOLEAN


def test_parameter_config_old_select_conversion(base_parameter):
    base_parameter["type"] = "select"
    param = ParameterConfig(**base_parameter)
    assert param.type == SegmentType.STRING


def test_parameter_config_invalid_type(base_parameter):
    base_parameter["type"] = "invalid_type"
    with pytest.raises(ValidationError):
        ParameterConfig(**base_parameter)


def test_is_array_type_true(array_string_parameter):
    param = ParameterConfig(**array_string_parameter)
    assert param.is_array_type() is True


def test_is_array_type_false(string_parameter):
    param = ParameterConfig(**string_parameter)
    assert param.is_array_type() is False


def test_element_type_success(array_string_parameter):
    param = ParameterConfig(**array_string_parameter)
    assert param.element_type() == SegmentType.STRING


def test_element_type_non_array_raises(string_parameter):
    param = ParameterConfig(**string_parameter)
    with pytest.raises(ValueError):
        param.element_type()


def test_parameter_config_with_options(string_parameter):
    string_parameter["options"] = ["a", "b"]
    param = ParameterConfig(**string_parameter)
    assert param.options == ["a", "b"]


# ============================================================
# ParameterExtractorNodeData Tests
# ============================================================


def test_reasoning_mode_default_when_none(string_parameter):
    param = ParameterConfig(**string_parameter)

    node = ParameterExtractorNodeData.model_construct(
        title="test",
        model=None,
        query=["test"],
        parameters=[param],
        reasoning_mode=None,
        memory=None,
        vision=None,
    )

    # manually trigger validator
    node.reasoning_mode = ParameterExtractorNodeData.set_reasoning_mode(None)

    assert node.reasoning_mode == "function_call"


@pytest.mark.parametrize("mode", ["function_call", "prompt"])
def test_reasoning_mode_valid_values(build_node, string_parameter, mode):
    param = ParameterConfig(**string_parameter)
    node = build_node([param], reasoning_mode=mode)
    assert node.reasoning_mode == mode


def test_get_parameter_json_schema_string_type(build_node, string_parameter):
    param = ParameterConfig(**string_parameter)
    node = build_node([param])

    schema = node.get_parameter_json_schema()

    assert schema["type"] == "object"
    assert schema["properties"]["username"]["type"] == "string"
    assert schema["required"] == []


def test_get_parameter_json_schema_array_type(build_node, array_string_parameter):
    param = ParameterConfig(**array_string_parameter)
    node = build_node([param])

    schema = node.get_parameter_json_schema()

    assert schema["properties"]["tags"]["type"] == "array"
    assert schema["properties"]["tags"]["items"]["type"] == SegmentType.STRING.value
    assert "tags" in schema["required"]


def test_get_parameter_json_schema_with_enum(build_node, string_parameter):
    string_parameter["options"] = ["a", "b"]
    param = ParameterConfig(**string_parameter)
    node = build_node([param])

    schema = node.get_parameter_json_schema()

    assert schema["properties"]["username"]["enum"] == ["a", "b"]


def test_get_parameter_json_schema_number_type(build_node, base_parameter):
    param = ParameterConfig(**base_parameter)
    node = build_node([param])

    schema = node.get_parameter_json_schema()

    assert schema["properties"]["age"]["type"] == SegmentType.NUMBER
    assert "age" in schema["required"]


def test_get_parameter_json_schema_multiple_parameters(build_node, base_parameter, string_parameter):
    param1 = ParameterConfig(**base_parameter)
    param2 = ParameterConfig(**string_parameter)

    node = build_node([param1, param2])

    schema = node.get_parameter_json_schema()

    assert len(schema["properties"]) == 2
    assert "age" in schema["required"]
    assert "username" not in schema["required"]


def test_get_parameter_json_schema_element_type_none_raises(build_node, mocker, array_string_parameter):
    param = ParameterConfig(**array_string_parameter)

    mocker.patch.object(
        SegmentType,
        "element_type",
        return_value=None,
    )

    node = build_node([param])

    with pytest.raises(AssertionError):
        node.get_parameter_json_schema()
