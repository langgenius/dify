from collections.abc import Mapping
from typing import Any

from core.file.file_obj import FileVar

from .entities import (
    ArrayVariable,
    FileVariable,
    FloatVariable,
    IntegerVariable,
    ObjectVariable,
    SecretVariable,
    StringVariable,
    Variable,
    VariableType,
)


def from_mapping(m: Mapping[str, Any], /) -> Variable:
    if (value_type := m.get('value_type')) is None:
        raise ValueError('missing value type')
    if not (name := m.get('name')):
        raise ValueError('missing name')
    if not (value := m.get('value')):
        raise ValueError('missing value')
    match value_type:
        case VariableType.STRING:
            return StringVariable.model_validate(m)
        case VariableType.NUMBER if isinstance(value, int):
            return IntegerVariable.model_validate(m)
        case VariableType.NUMBER if isinstance(value, float):
            return FloatVariable.model_validate(m)
        case VariableType.SECRET:
            return SecretVariable.model_validate(m)
        case VariableType.NUMBER if not isinstance(value, float | int):
            raise ValueError(f'invalid number value {value}')
    raise ValueError(f'not supported value type {value_type}')


def build_anonymous_variable(value: Any, /) -> Variable:
    if isinstance(value, str):
        return StringVariable(name='anonymous', value=value)
    if isinstance(value, int):
        return IntegerVariable(name='anonymous', value=value)
    if isinstance(value, float):
        return FloatVariable(name='anonymous', value=value)
    if isinstance(value, dict):
        # TODO: Limit the depth of the object
        obj = {k: build_anonymous_variable(v) for k, v in value.items()}
        return ObjectVariable(name='anonymous', value=obj)
    if isinstance(value, list):
        # TODO: Limit the depth of the array
        elements = [build_anonymous_variable(v) for v in value]
        return ArrayVariable(name='anonymous', value=elements)
    if isinstance(value, FileVar):
        return FileVariable(name='anonymous', value=value)
    raise ValueError(f'not supported value {value}')
