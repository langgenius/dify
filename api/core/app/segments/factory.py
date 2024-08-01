from collections.abc import Mapping
from typing import Any

from core.file.file_obj import FileVar

from .segments import (
    ArrayAnySegment,
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
    ArrayFileVariable,
    ArrayNumberVariable,
    ArrayObjectVariable,
    ArrayStringVariable,
    FileVariable,
    FloatVariable,
    IntegerVariable,
    ObjectVariable,
    SecretVariable,
    StringVariable,
    Variable,
)


def build_variable_from_mapping(mapping: Mapping[str, Any], /) -> Variable:
    if (value_type := mapping.get('value_type')) is None:
        raise ValueError('missing value type')
    if not mapping.get('name'):
        raise ValueError('missing name')
    if (value := mapping.get('value')) is None:
        raise ValueError('missing value')
    match value_type:
        case SegmentType.STRING:
            return StringVariable.model_validate(mapping)
        case SegmentType.SECRET:
            return SecretVariable.model_validate(mapping)
        case SegmentType.NUMBER if isinstance(value, int):
            return IntegerVariable.model_validate(mapping)
        case SegmentType.NUMBER if isinstance(value, float):
            return FloatVariable.model_validate(mapping)
        case SegmentType.NUMBER if not isinstance(value, float | int):
            raise ValueError(f'invalid number value {value}')
        case SegmentType.FILE:
            return FileVariable.model_validate(mapping)
        case SegmentType.OBJECT if isinstance(value, dict):
            return ObjectVariable.model_validate(mapping)
        case SegmentType.ARRAY_STRING if isinstance(value, list):
            return ArrayStringVariable.model_validate(mapping)
        case SegmentType.ARRAY_NUMBER if isinstance(value, list):
            return ArrayNumberVariable.model_validate(mapping)
        case SegmentType.ARRAY_OBJECT if isinstance(value, list):
            return ArrayObjectVariable.model_validate(mapping)
        case SegmentType.ARRAY_FILE if isinstance(value, list):
            mapping = dict(mapping)
            mapping['value'] = [{'value': v} for v in value]
            return ArrayFileVariable.model_validate(mapping)
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
        return ObjectSegment(value=value)
    if isinstance(value, list):
        return ArrayAnySegment(value=value)
    if isinstance(value, FileVar):
        return FileSegment(value=value)
    raise ValueError(f'not supported value {value}')
