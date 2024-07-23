import pytest
from pydantic import ValidationError

from core.app.segments import (
    ArrayVariable,
    FloatVariable,
    IntegerVariable,
    NoneVariable,
    ObjectVariable,
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


def test_object_variable_to_object():
    var = ObjectVariable(
        name='object',
        value={
            'key1': ObjectVariable(
                name='object',
                value={
                    'key2': StringVariable(name='key2', value='value2'),
                },
            ),
            'key2': ArrayVariable(
                name='array',
                value=[
                    StringVariable(name='key5_1', value='value5_1'),
                    IntegerVariable(name='key5_2', value=42),
                    ObjectVariable(name='key5_3', value={}),
                ],
            ),
        },
    )

    assert var.to_object() == {
        'key1': {
            'key2': 'value2',
        },
        'key2': [
            'value5_1',
            42,
            {},
        ],
    }


def test_variable_to_object():
    var = StringVariable(name='text', value='text')
    assert var.to_object() == 'text'
    var = IntegerVariable(name='integer', value=42)
    assert var.to_object() == 42
    var = FloatVariable(name='float', value=3.14)
    assert var.to_object() == 3.14
    var = SecretVariable(name='secret', value='secret_value')
    assert var.to_object() == 'secret_value'


def test_build_a_object_variable_with_none_value():
    var = factory.build_anonymous_variable(
        {
            'key1': None,
        }
    )
    assert isinstance(var, ObjectVariable)
    assert isinstance(var.value['key1'], NoneVariable)
