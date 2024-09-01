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
