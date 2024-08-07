import pytest

from core.tools.entities.tool_entities import ToolParameter
from core.tools.utils.tool_parameter_converter import ToolParameterConverter


def test_get_parameter_type():
    assert ToolParameterConverter.get_parameter_type(ToolParameter.ToolParameterType.STRING) == 'string'
    assert ToolParameterConverter.get_parameter_type(ToolParameter.ToolParameterType.SELECT) == 'string'
    assert ToolParameterConverter.get_parameter_type(ToolParameter.ToolParameterType.BOOLEAN) == 'boolean'
    assert ToolParameterConverter.get_parameter_type(ToolParameter.ToolParameterType.NUMBER) == 'number'
    with pytest.raises(ValueError):
        ToolParameterConverter.get_parameter_type('unsupported_type')


def test_cast_parameter_by_type():
    # string
    assert ToolParameterConverter.cast_parameter_by_type('test', ToolParameter.ToolParameterType.STRING) == 'test'
    assert ToolParameterConverter.cast_parameter_by_type(1, ToolParameter.ToolParameterType.STRING) == '1'
    assert ToolParameterConverter.cast_parameter_by_type(1.0, ToolParameter.ToolParameterType.STRING) == '1.0'
    assert ToolParameterConverter.cast_parameter_by_type(None, ToolParameter.ToolParameterType.STRING) == ''

    # secret input
    assert ToolParameterConverter.cast_parameter_by_type('test', ToolParameter.ToolParameterType.SECRET_INPUT) == 'test'
    assert ToolParameterConverter.cast_parameter_by_type(1, ToolParameter.ToolParameterType.SECRET_INPUT) == '1'
    assert ToolParameterConverter.cast_parameter_by_type(1.0, ToolParameter.ToolParameterType.SECRET_INPUT) == '1.0'
    assert ToolParameterConverter.cast_parameter_by_type(None, ToolParameter.ToolParameterType.SECRET_INPUT) == ''

    # select
    assert ToolParameterConverter.cast_parameter_by_type('test', ToolParameter.ToolParameterType.SELECT) == 'test'
    assert ToolParameterConverter.cast_parameter_by_type(1, ToolParameter.ToolParameterType.SELECT) == '1'
    assert ToolParameterConverter.cast_parameter_by_type(1.0, ToolParameter.ToolParameterType.SELECT) == '1.0'
    assert ToolParameterConverter.cast_parameter_by_type(None, ToolParameter.ToolParameterType.SELECT) == ''

    # boolean
    true_values = [True, 'True', 'true', '1', 'YES', 'Yes', 'yes', 'y', 'something']
    for value in true_values:
        assert ToolParameterConverter.cast_parameter_by_type(value, ToolParameter.ToolParameterType.BOOLEAN) is True

    false_values = [False, 'False', 'false', '0', 'NO', 'No', 'no', 'n', None, '']
    for value in false_values:
        assert ToolParameterConverter.cast_parameter_by_type(value, ToolParameter.ToolParameterType.BOOLEAN) is False

    # number
    assert ToolParameterConverter.cast_parameter_by_type('1', ToolParameter.ToolParameterType.NUMBER) == 1
    assert ToolParameterConverter.cast_parameter_by_type('1.0', ToolParameter.ToolParameterType.NUMBER) == 1.0
    assert ToolParameterConverter.cast_parameter_by_type('-1.0', ToolParameter.ToolParameterType.NUMBER) == -1.0
    assert ToolParameterConverter.cast_parameter_by_type(1, ToolParameter.ToolParameterType.NUMBER) == 1
    assert ToolParameterConverter.cast_parameter_by_type(1.0, ToolParameter.ToolParameterType.NUMBER) == 1.0
    assert ToolParameterConverter.cast_parameter_by_type(-1.0, ToolParameter.ToolParameterType.NUMBER) == -1.0
    assert ToolParameterConverter.cast_parameter_by_type(None, ToolParameter.ToolParameterType.NUMBER) is None

    # unknown
    assert ToolParameterConverter.cast_parameter_by_type('1', 'unknown_type') == '1'
    assert ToolParameterConverter.cast_parameter_by_type(1, 'unknown_type') == '1'
    assert ToolParameterConverter.cast_parameter_by_type(None, ToolParameter.ToolParameterType.NUMBER) is None
