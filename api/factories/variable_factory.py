from collections.abc import Mapping, Sequence
from typing import Any
from uuid import uuid4

from configs import dify_config
from core.file import File
from core.variables.exc import VariableError
from core.variables.segments import (
    ArrayAnySegment,
    ArrayFileSegment,
    ArrayNumberSegment,
    ArrayObjectSegment,
    ArraySegment,
    ArrayStringSegment,
    FileSegment,
    FloatSegment,
    IntegerSegment,
    NoneSegment,
    ObjectSegment,
    Segment,
    StringSegment,
)
from core.variables.types import SegmentType
from core.variables.variables import (
    ArrayAnyVariable,
    ArrayFileVariable,
    ArrayNumberVariable,
    ArrayObjectVariable,
    ArrayStringVariable,
    FileVariable,
    FloatVariable,
    IntegerVariable,
    NoneVariable,
    ObjectVariable,
    SecretVariable,
    StringVariable,
    Variable,
)


class InvalidSelectorError(ValueError):
    pass


class UnsupportedSegmentTypeError(Exception):
    pass


# Define the constant
SEGMENT_TO_VARIABLE_MAP = {
    StringSegment: StringVariable,
    IntegerSegment: IntegerVariable,
    FloatSegment: FloatVariable,
    ObjectSegment: ObjectVariable,
    FileSegment: FileVariable,
    ArrayStringSegment: ArrayStringVariable,
    ArrayNumberSegment: ArrayNumberVariable,
    ArrayObjectSegment: ArrayObjectVariable,
    ArrayFileSegment: ArrayFileVariable,
    ArrayAnySegment: ArrayAnyVariable,
    NoneSegment: NoneVariable,
}


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
            case SegmentType.NONE:
                return ArrayAnySegment(value=value)
            case _:
                raise ValueError(f"not supported value {value}")
    raise ValueError(f"not supported value {value}")


def segment_to_variable(
    *,
    segment: Segment,
    selector: Sequence[str],
    id: str | None = None,
    name: str | None = None,
    description: str = "",
) -> Variable:
    if isinstance(segment, Variable):
        return segment
    name = name or selector[-1]
    id = id or str(uuid4())

    segment_type = type(segment)
    if segment_type not in SEGMENT_TO_VARIABLE_MAP:
        raise UnsupportedSegmentTypeError(f"not supported segment type {segment_type}")

    variable_class = SEGMENT_TO_VARIABLE_MAP[segment_type]
    return variable_class(
        id=id,
        name=name,
        description=description,
        value=segment.value,
        selector=selector,
    )
