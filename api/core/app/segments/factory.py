from collections.abc import Mapping
from typing import Any

from core.file.file_obj import FileVar

from .segments import (
    ArraySegment,
    FileSegment,
    FloatSegment,
    IntegerSegment,
    NoneSegment,
    ObjectSegment,
    Segment,
    StringSegment,
)
from .types import SegmentType
from .variables import (
    FloatVariable,
    IntegerVariable,
    SecretVariable,
    StringVariable,
    Variable,
)


def build_variable_from_mapping(m: Mapping[str, Any], /) -> Variable:
    if (value_type := m.get('value_type')) is None:
        raise ValueError('missing value type')
    if not m.get('name'):
        raise ValueError('missing name')
    if (value := m.get('value')) is None:
        raise ValueError('missing value')
    match value_type:
        case SegmentType.STRING:
            return StringVariable.model_validate(m)
        case SegmentType.NUMBER if isinstance(value, int):
            return IntegerVariable.model_validate(m)
        case SegmentType.NUMBER if isinstance(value, float):
            return FloatVariable.model_validate(m)
        case SegmentType.SECRET:
            return SecretVariable.model_validate(m)
        case SegmentType.NUMBER if not isinstance(value, float | int):
            raise ValueError(f'invalid number value {value}')
    raise ValueError(f'not supported value type {value_type}')


def build_segment(value: Any, /) -> Segment:
    if value is None:
        return NoneSegment()
    if isinstance(value, str):
        return StringSegment(value=value)
    if isinstance(value, int):
        return IntegerSegment(value=value)
    if isinstance(value, float):
        return FloatSegment(value=value)
    if isinstance(value, dict):
        # TODO: Limit the depth of the object
        obj = {k: build_segment(v) for k, v in value.items()}
        return ObjectSegment(value=obj)
    if isinstance(value, list):
        # TODO: Limit the depth of the array
        elements = [build_segment(v) for v in value]
        return ArraySegment(value=elements)
    if isinstance(value, FileVar):
        return FileSegment(value=value)
    raise ValueError(f'not supported value {value}')
