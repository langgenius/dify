import pytest
from pydantic import ValidationError

from core.app.segments import (
    FloatVariable,
    IntegerVariable,
    SecretVariable,
    SegmentType,
    StringVariable,
    factory,
)


def test_string_variable():
    test_data = {'value_type': 'string', 'name': 'test_text', 'value': 'Hello, World!'}
    result = factory.build_variable_from_mapping(test_data)
    assert isinstance(result, StringVariable)


def test_integer_variable():
    test_data = {'value_type': 'number', 'name': 'test_int', 'value': 42}
    result = factory.build_variable_from_mapping(test_data)
    assert isinstance(result, IntegerVariable)


def test_float_variable():
    test_data = {'value_type': 'number', 'name': 'test_float', 'value': 3.14}
    result = factory.build_variable_from_mapping(test_data)
    assert isinstance(result, FloatVariable)


def test_secret_variable():
    test_data = {'value_type': 'secret', 'name': 'test_secret', 'value': 'secret_value'}
    result = factory.build_variable_from_mapping(test_data)
    assert isinstance(result, SecretVariable)


def test_invalid_value_type():
    test_data = {'value_type': 'unknown', 'name': 'test_invalid', 'value': 'value'}
    with pytest.raises(ValueError):
        factory.build_variable_from_mapping(test_data)


def test_frozen_variables():
    var = StringVariable(name='text', value='text')
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
        StringVariable(value_type=SegmentType.ARRAY, name='text', value='text')

    with pytest.raises(ValidationError):
        StringVariable.model_validate({'value_type': 'not text', 'name': 'text', 'value': 'text'})

    var = IntegerVariable(name='integer', value=42)
    with pytest.raises(ValidationError):
        IntegerVariable(value_type=SegmentType.ARRAY, name=var.name, value=var.value)

    var = FloatVariable(name='float', value=3.14)
    with pytest.raises(ValidationError):
        FloatVariable(value_type=SegmentType.ARRAY, name=var.name, value=var.value)

    var = SecretVariable(name='secret', value='secret_value')
    with pytest.raises(ValidationError):
        SecretVariable(value_type=SegmentType.ARRAY, name=var.name, value=var.value)


def test_build_a_blank_string():
    result = factory.build_variable_from_mapping(
        {
            'value_type': 'string',
            'name': 'blank',
            'value': '',
        }
    )
    assert isinstance(result, StringVariable)
    assert result.value == ''
