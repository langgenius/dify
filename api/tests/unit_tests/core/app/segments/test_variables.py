import pytest
from pydantic import ValidationError

from core.app.segments import (
    ArrayAnyVariable,
    FloatVariable,
    IntegerVariable,
    ObjectVariable,
    SecretVariable,
    SegmentType,
    StringVariable,
)


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
        StringVariable(value_type=SegmentType.ARRAY_ANY, name='text', value='text')

    with pytest.raises(ValidationError):
        StringVariable.model_validate({'value_type': 'not text', 'name': 'text', 'value': 'text'})

    var = IntegerVariable(name='integer', value=42)
    with pytest.raises(ValidationError):
        IntegerVariable(value_type=SegmentType.ARRAY_ANY, name=var.name, value=var.value)

    var = FloatVariable(name='float', value=3.14)
    with pytest.raises(ValidationError):
        FloatVariable(value_type=SegmentType.ARRAY_ANY, name=var.name, value=var.value)

    var = SecretVariable(name='secret', value='secret_value')
    with pytest.raises(ValidationError):
        SecretVariable(value_type=SegmentType.ARRAY_ANY, name=var.name, value=var.value)


def test_object_variable_to_object():
    var = ObjectVariable(
        name='object',
        value={
            'key1': {
                'key2': 'value2',
            },
            'key2': ['value5_1', 42, {}],
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
