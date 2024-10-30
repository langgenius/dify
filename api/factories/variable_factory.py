from collections.abc import Mapping
from typing import Any

from configs import dify_config
from core.file import File
from core.variables import (
    ArrayAnySegment,
    ArrayFileSegment,
    ArrayNumberSegment,
    ArrayNumberVariable,
    ArrayObjectSegment,
    ArrayObjectVariable,
    ArraySegment,
    ArrayStringSegment,
    ArrayStringVariable,
    FileSegment,
    FloatSegment,
    FloatVariable,
    IntegerSegment,
    IntegerVariable,
    NoneSegment,
    ObjectSegment,
    ObjectVariable,
    SecretVariable,
    Segment,
    SegmentType,
    StringSegment,
    StringVariable,
    Variable,
)
from core.variables.exc import VariableError


def build_variable_from_mapping(mapping: Mapping[str, Any], /) -> Variable:
    if (value_type := mapping.get("value_type")) is None:
        raise VariableError("missing value type")
    if not mapping.get("name"):
        raise VariableError("missing name")
    if (value := mapping.get("value")) is None:
        raise VariableError("missing value")
    match value_type:
        case SegmentType.STRING:
            result = StringVariable.model_validate(mapping)
        case SegmentType.SECRET:
            result = SecretVariable.model_validate(mapping)
        case SegmentType.NUMBER if isinstance(value, int):
            result = IntegerVariable.model_validate(mapping)
        case SegmentType.NUMBER if isinstance(value, float):
            result = FloatVariable.model_validate(mapping)
        case SegmentType.NUMBER if not isinstance(value, float | int):
            raise VariableError(f"invalid number value {value}")
        case SegmentType.OBJECT if isinstance(value, dict):
            result = ObjectVariable.model_validate(mapping)
        case SegmentType.ARRAY_STRING if isinstance(value, list):
            result = ArrayStringVariable.model_validate(mapping)
        case SegmentType.ARRAY_NUMBER if isinstance(value, list):
            result = ArrayNumberVariable.model_validate(mapping)
        case SegmentType.ARRAY_OBJECT if isinstance(value, list):
            result = ArrayObjectVariable.model_validate(mapping)
        case _:
            raise VariableError(f"not supported value type {value_type}")
    if result.size > dify_config.MAX_VARIABLE_SIZE:
        raise VariableError(f"variable size {result.size} exceeds limit {dify_config.MAX_VARIABLE_SIZE}")
    return result


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
    if isinstance(value, File):
        return FileSegment(value=value)
    if isinstance(value, list):
        items = [build_segment(item) for item in value]
        types = {item.value_type for item in items}
        if len(types) != 1 or all(isinstance(item, ArraySegment) for item in items):
            return ArrayAnySegment(value=value)
        match types.pop():
            case SegmentType.STRING:
                return ArrayStringSegment(value=value)
            case SegmentType.NUMBER:
                return ArrayNumberSegment(value=value)
            case SegmentType.OBJECT:
                return ArrayObjectSegment(value=value)
            case SegmentType.FILE:
                return ArrayFileSegment(value=value)
            case _:
                raise ValueError(f"not supported value {value}")
    raise ValueError(f"not supported value {value}")
