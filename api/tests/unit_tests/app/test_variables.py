import pytest

from core.app.variables import FloatVariable, IntegerVariable, SecretVariable, TextVariable, variable_factory


def test_text_variable():
    test_data = {'value_type': 'text', 'name': 'test_text', 'value': 'Hello, World!'}
    result = variable_factory.from_mapping(test_data)
    assert isinstance(result, TextVariable)


def test_integer_variable():
    test_data = {'value_type': 'number', 'name': 'test_int', 'value': 42}
    result = variable_factory.from_mapping(test_data)
    assert isinstance(result, IntegerVariable)


def test_float_variable():
    test_data = {'value_type': 'number', 'name': 'test_float', 'value': 3.14}
    result = variable_factory.from_mapping(test_data)
    assert isinstance(result, FloatVariable)


def test_secret_variable():
    test_data = {'value_type': 'secret', 'name': 'test_secret', 'value': 'secret_value'}
    result = variable_factory.from_mapping(test_data)
    assert isinstance(result, SecretVariable)


def test_invalid_value_type():
    test_data = {'value_type': 'unknown', 'name': 'test_invalid', 'value': 'value'}
    with pytest.raises(ValueError):
        variable_factory.from_mapping(test_data)
