import pytest

from core.tools.entities.tool_entities import ToolParameter


def test_get_parameter_type():
    assert ToolParameter.ToolParameterType.STRING.as_normal_type() == "string"
    assert ToolParameter.ToolParameterType.SELECT.as_normal_type() == "string"
    assert ToolParameter.ToolParameterType.SECRET_INPUT.as_normal_type() == "string"
    assert ToolParameter.ToolParameterType.BOOLEAN.as_normal_type() == "boolean"
    assert ToolParameter.ToolParameterType.NUMBER.as_normal_type() == "number"
    assert ToolParameter.ToolParameterType.FILE.as_normal_type() == "file"
    assert ToolParameter.ToolParameterType.FILES.as_normal_type() == "files"


def test_cast_parameter_by_type():
    # string
    assert ToolParameter.ToolParameterType.STRING.cast_value("test") == "test"
    assert ToolParameter.ToolParameterType.STRING.cast_value(1) == "1"
    assert ToolParameter.ToolParameterType.STRING.cast_value(1.0) == "1.0"
    assert ToolParameter.ToolParameterType.STRING.cast_value(None) == ""

    # secret input
    assert ToolParameter.ToolParameterType.SECRET_INPUT.cast_value("test") == "test"
    assert ToolParameter.ToolParameterType.SECRET_INPUT.cast_value(1) == "1"
    assert ToolParameter.ToolParameterType.SECRET_INPUT.cast_value(1.0) == "1.0"
    assert ToolParameter.ToolParameterType.SECRET_INPUT.cast_value(None) == ""

    # select
    assert ToolParameter.ToolParameterType.SELECT.cast_value("test") == "test"
    assert ToolParameter.ToolParameterType.SELECT.cast_value(1) == "1"
    assert ToolParameter.ToolParameterType.SELECT.cast_value(1.0) == "1.0"
    assert ToolParameter.ToolParameterType.SELECT.cast_value(None) == ""

    # boolean
    true_values = [True, "True", "true", "1", "YES", "Yes", "yes", "y", "something"]
    for value in true_values:
        assert ToolParameter.ToolParameterType.BOOLEAN.cast_value(value) is True

    false_values = [False, "False", "false", "0", "NO", "No", "no", "n", None, ""]
    for value in false_values:
        assert ToolParameter.ToolParameterType.BOOLEAN.cast_value(value) is False

    # number
    assert ToolParameter.ToolParameterType.NUMBER.cast_value("1") == 1
    assert ToolParameter.ToolParameterType.NUMBER.cast_value("1.0") == 1.0
    assert ToolParameter.ToolParameterType.NUMBER.cast_value("-1.0") == -1.0
    assert ToolParameter.ToolParameterType.NUMBER.cast_value(1) == 1
    assert ToolParameter.ToolParameterType.NUMBER.cast_value(1.0) == 1.0
    assert ToolParameter.ToolParameterType.NUMBER.cast_value(-1.0) == -1.0
    assert ToolParameter.ToolParameterType.NUMBER.cast_value(None) is None


def test_cast_object_accepts_dicts_and_json_strings():
    payload = {"task_tickets": [{"task_id": "t1"}]}

    assert ToolParameter.ToolParameterType.OBJECT.cast_value(payload) == payload
    assert ToolParameter.ToolParameterType.OBJECT.cast_value('{"task_tickets": [{"task_id": "t1"}]}') == payload


def test_cast_object_treats_unset_values_as_empty_object():
    assert ToolParameter.ToolParameterType.OBJECT.cast_value(None) == {}
    assert ToolParameter.ToolParameterType.OBJECT.cast_value("") == {}
    assert ToolParameter.ToolParameterType.OBJECT.cast_value("   ") == {}


def test_cast_object_rejects_malformed_json_instead_of_silently_emptying():
    # A truncated JSON object (missing the final closing brace) must not degrade to {}.
    truncated = '{"task_tickets": [{"task_id": "t1", "subagent_name": "a", "task_ticket": "x"}]'

    with pytest.raises(ValueError, match="is not valid JSON"):
        ToolParameter.ToolParameterType.OBJECT.cast_value(truncated)


def test_cast_object_rejects_json_that_is_not_an_object():
    with pytest.raises(ValueError, match="must be a JSON object"):
        ToolParameter.ToolParameterType.OBJECT.cast_value("[1, 2, 3]")

    with pytest.raises(ValueError, match="must be a JSON object"):
        ToolParameter.ToolParameterType.OBJECT.cast_value(123)


def test_cast_array_accepts_lists_and_json_strings():
    assert ToolParameter.ToolParameterType.ARRAY.cast_value([1, 2]) == [1, 2]
    assert ToolParameter.ToolParameterType.ARRAY.cast_value("[1, 2]") == [1, 2]


def test_cast_array_still_wraps_plain_scalars():
    # Long-standing convenience behaviour: a bare scalar becomes a single-element array.
    assert ToolParameter.ToolParameterType.ARRAY.cast_value("plain text") == ["plain text"]
    assert ToolParameter.ToolParameterType.ARRAY.cast_value(1) == [1]
    assert ToolParameter.ToolParameterType.ARRAY.cast_value(None) == []


def test_cast_array_rejects_malformed_json_instead_of_wrapping_it():
    # Wrapping a truncated array in a list produces a bogus single-element array downstream.
    truncated = '[{"task_id": "t1"}'

    with pytest.raises(ValueError, match="is not valid JSON"):
        ToolParameter.ToolParameterType.ARRAY.cast_value(truncated)
