from uuid import uuid4

import pytest

from core.app.segments import (
    ArrayFileVariable,
    ArrayNumberVariable,
    ArrayObjectVariable,
    ArrayStringVariable,
    FileVariable,
    FloatVariable,
    IntegerVariable,
    NoneSegment,
    ObjectSegment,
    SecretVariable,
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


def test_build_a_object_variable_with_none_value():
    var = factory.build_segment(
        {
            'key1': None,
        }
    )
    assert isinstance(var, ObjectSegment)
    assert isinstance(var.value['key1'], NoneSegment)


def test_object_variable():
    mapping = {
        'id': str(uuid4()),
        'value_type': 'object',
        'name': 'test_object',
        'description': 'Description of the variable.',
        'value': {
            'key1': {
                'id': str(uuid4()),
                'value_type': 'string',
                'name': 'text',
                'value': 'text',
                'description': 'Description of the variable.',
            },
            'key2': {
                'id': str(uuid4()),
                'value_type': 'number',
                'name': 'number',
                'value': 1,
                'description': 'Description of the variable.',
            },
        },
    }
    variable = factory.build_variable_from_mapping(mapping)
    assert isinstance(variable, ObjectSegment)
    assert isinstance(variable.value['key1'], StringVariable)
    assert isinstance(variable.value['key2'], IntegerVariable)


def test_array_string_variable():
    mapping = {
        'id': str(uuid4()),
        'value_type': 'array[string]',
        'name': 'test_array',
        'description': 'Description of the variable.',
        'value': [
            {
                'id': str(uuid4()),
                'value_type': 'string',
                'name': 'text',
                'value': 'text',
                'description': 'Description of the variable.',
            },
            {
                'id': str(uuid4()),
                'value_type': 'string',
                'name': 'text',
                'value': 'text',
                'description': 'Description of the variable.',
            },
        ],
    }
    variable = factory.build_variable_from_mapping(mapping)
    assert isinstance(variable, ArrayStringVariable)
    assert isinstance(variable.value[0], StringVariable)
    assert isinstance(variable.value[1], StringVariable)


def test_array_number_variable():
    mapping = {
        'id': str(uuid4()),
        'value_type': 'array[number]',
        'name': 'test_array',
        'description': 'Description of the variable.',
        'value': [
            {
                'id': str(uuid4()),
                'value_type': 'number',
                'name': 'number',
                'value': 1,
                'description': 'Description of the variable.',
            },
            {
                'id': str(uuid4()),
                'value_type': 'number',
                'name': 'number',
                'value': 2.0,
                'description': 'Description of the variable.',
            },
        ],
    }
    variable = factory.build_variable_from_mapping(mapping)
    assert isinstance(variable, ArrayNumberVariable)
    assert isinstance(variable.value[0], IntegerVariable)
    assert isinstance(variable.value[1], FloatVariable)


def test_array_object_variable():
    mapping = {
        'id': str(uuid4()),
        'value_type': 'array[object]',
        'name': 'test_array',
        'description': 'Description of the variable.',
        'value': [
            {
                'id': str(uuid4()),
                'value_type': 'object',
                'name': 'object',
                'description': 'Description of the variable.',
                'value': {
                    'key1': {
                        'id': str(uuid4()),
                        'value_type': 'string',
                        'name': 'text',
                        'value': 'text',
                        'description': 'Description of the variable.',
                    },
                    'key2': {
                        'id': str(uuid4()),
                        'value_type': 'number',
                        'name': 'number',
                        'value': 1,
                        'description': 'Description of the variable.',
                    },
                },
            },
            {
                'id': str(uuid4()),
                'value_type': 'object',
                'name': 'object',
                'description': 'Description of the variable.',
                'value': {
                    'key1': {
                        'id': str(uuid4()),
                        'value_type': 'string',
                        'name': 'text',
                        'value': 'text',
                        'description': 'Description of the variable.',
                    },
                    'key2': {
                        'id': str(uuid4()),
                        'value_type': 'number',
                        'name': 'number',
                        'value': 1,
                        'description': 'Description of the variable.',
                    },
                },
            },
        ],
    }
    variable = factory.build_variable_from_mapping(mapping)
    assert isinstance(variable, ArrayObjectVariable)
    assert isinstance(variable.value[0], ObjectSegment)
    assert isinstance(variable.value[1], ObjectSegment)
    assert isinstance(variable.value[0].value['key1'], StringVariable)
    assert isinstance(variable.value[0].value['key2'], IntegerVariable)
    assert isinstance(variable.value[1].value['key1'], StringVariable)
    assert isinstance(variable.value[1].value['key2'], IntegerVariable)


def test_file_variable():
    mapping = {
        'id': str(uuid4()),
        'value_type': 'file',
        'name': 'test_file',
        'description': 'Description of the variable.',
        'value': {
            'id': str(uuid4()),
            'tenant_id': 'tenant_id',
            'type': 'image',
            'transfer_method': 'local_file',
            'url': 'url',
            'related_id': 'related_id',
            'extra_config': {
                'image_config': {
                    'width': 100,
                    'height': 100,
                },
            },
            'filename': 'filename',
            'extension': 'extension',
            'mime_type': 'mime_type',
        },
    }
    variable = factory.build_variable_from_mapping(mapping)
    assert isinstance(variable, FileVariable)


def test_array_file_variable():
    mapping = {
        'id': str(uuid4()),
        'value_type': 'array[file]',
        'name': 'test_array_file',
        'description': 'Description of the variable.',
        'value': [
            {
                'id': str(uuid4()),
                'name': 'file',
                'value_type': 'file',
                'value': {
                    'id': str(uuid4()),
                    'tenant_id': 'tenant_id',
                    'type': 'image',
                    'transfer_method': 'local_file',
                    'url': 'url',
                    'related_id': 'related_id',
                    'extra_config': {
                        'image_config': {
                            'width': 100,
                            'height': 100,
                        },
                    },
                    'filename': 'filename',
                    'extension': 'extension',
                    'mime_type': 'mime_type',
                },
            },
            {
                'id': str(uuid4()),
                'name': 'file',
                'value_type': 'file',
                'value': {
                    'id': str(uuid4()),
                    'tenant_id': 'tenant_id',
                    'type': 'image',
                    'transfer_method': 'local_file',
                    'url': 'url',
                    'related_id': 'related_id',
                    'extra_config': {
                        'image_config': {
                            'width': 100,
                            'height': 100,
                        },
                    },
                    'filename': 'filename',
                    'extension': 'extension',
                    'mime_type': 'mime_type',
                },
            },
        ],
    }
    variable = factory.build_variable_from_mapping(mapping)
    assert isinstance(variable, ArrayFileVariable)
    assert isinstance(variable.value[0], FileVariable)
    assert isinstance(variable.value[1], FileVariable)
