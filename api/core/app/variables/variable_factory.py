from collections.abc import Mapping
from typing import Any

from .eneities import FloatVariable, IntegerVariable, SecretVariable, TextVariable, Variable


def from_mapping(m: Mapping[str, Any], /) -> Variable:
    if (value_type := m.get('value_type')) is None:
        raise ValueError('missing value type')
    if not (name := m.get('name')):
        raise ValueError('missing name')
    if not (value := m.get('value')):
        raise ValueError('missing value')
    match value_type:
        case 'text':
            return TextVariable.model_validate(m)
        case 'number' if isinstance(value, int):
            return IntegerVariable.model_validate(m)
        case 'number' if isinstance(value, float):
            return FloatVariable.model_validate(m)
        case 'secret':
            return SecretVariable.model_validate(m)
        case 'number' if not isinstance(value, float | int):
            raise ValueError(f'invalid number value {value}')
    raise ValueError(f'not supported value type {value_type}')
