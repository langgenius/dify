import pytest
from pydantic import ValidationError

from core.app.variables import FloatVariable, IntegerVariable, SecretVariable, TextVariable, variable_factory
from core.app.variables.entities import VariableType


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


def test_frozen_variables():
    var = TextVariable(name='text', value='text')
    with pytest.raises(ValidationError):
        var.value = 'new value'

    int_var = IntegerVariable(name='integer', value=42)
    with pytest.raises(ValidationError):
        int_var.value = 100

    float_var = FloatVariable(name='float', value=3.14)
    with pytest.raises(ValidationError):
        float_var.value = 2.718

    secret_var = SecretVariable(name='secret', value='secret_value')
    with pytest.raises(ValidationError):
        secret_var.value = 'new_secret_value'


def test_variable_value_type_immutable():
    with pytest.raises(ValidationError):
        TextVariable(value_type=VariableType.ARRAY, name='text', value='text')

    with pytest.raises(ValidationError):
        TextVariable.model_validate({
            'value_type': 'not text',
            'name': 'text',
            'value': 'text'
        })

    var = IntegerVariable(name='integer', value=42)
    with pytest.raises(ValidationError):
        IntegerVariable(value_type=VariableType.ARRAY, name=var.name, value=var.value)

    var = FloatVariable(name='float', value=3.14)
    with pytest.raises(ValidationError):
        FloatVariable(value_type=VariableType.ARRAY, name=var.name, value=var.value)

    var = SecretVariable(name='secret', value='secret_value')
    with pytest.raises(ValidationError):
        SecretVariable(value_type=VariableType.ARRAY, name=var.name, value=var.value)
