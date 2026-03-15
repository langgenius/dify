"""Graph-owned helpers for converting runtime values, segments, and variables.

These conversions are part of the `dify_graph` runtime model and must stay
independent from top-level API factory modules so graph nodes and state
containers can operate without importing application-layer packages.
"""

from collections.abc import Mapping, Sequence
from typing import Any, cast
from uuid import uuid4

from dify_graph.file import File

from .segments import (
    ArrayAnySegment,
    ArrayBooleanSegment,
    ArrayFileSegment,
    ArrayNumberSegment,
    ArrayObjectSegment,
    ArraySegment,
    ArrayStringSegment,
    BooleanSegment,
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
    ArrayAnyVariable,
    ArrayBooleanVariable,
    ArrayFileVariable,
    ArrayNumberVariable,
    ArrayObjectVariable,
    ArrayStringVariable,
    BooleanVariable,
    FileVariable,
    FloatVariable,
    IntegerVariable,
    NoneVariable,
    ObjectVariable,
    StringVariable,
    VariableBase,
)


class UnsupportedSegmentTypeError(Exception):
    pass


class TypeMismatchError(Exception):
    pass


SEGMENT_TO_VARIABLE_MAP: Mapping[type[Segment], type[Any]] = {
    ArrayAnySegment: ArrayAnyVariable,
    ArrayBooleanSegment: ArrayBooleanVariable,
    ArrayFileSegment: ArrayFileVariable,
    ArrayNumberSegment: ArrayNumberVariable,
    ArrayObjectSegment: ArrayObjectVariable,
    ArrayStringSegment: ArrayStringVariable,
    BooleanSegment: BooleanVariable,
    FileSegment: FileVariable,
    FloatSegment: FloatVariable,
    IntegerSegment: IntegerVariable,
    NoneSegment: NoneVariable,
    ObjectSegment: ObjectVariable,
    StringSegment: StringVariable,
}


def build_segment(value: Any, /) -> Segment:
    """Build a runtime segment from a Python value."""
    if value is None:
        return NoneSegment()
    if isinstance(value, Segment):
        return value
    if isinstance(value, str):
        return StringSegment(value=value)
    if isinstance(value, bool):
        return BooleanSegment(value=value)
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
        if all(isinstance(item, ArraySegment) for item in items):
            return ArrayAnySegment(value=value)
        if len(types) != 1:
            if types.issubset({SegmentType.NUMBER, SegmentType.INTEGER, SegmentType.FLOAT}):
                return ArrayNumberSegment(value=value)
            return ArrayAnySegment(value=value)

        match types.pop():
            case SegmentType.STRING:
                return ArrayStringSegment(value=value)
            case SegmentType.NUMBER | SegmentType.INTEGER | SegmentType.FLOAT:
                return ArrayNumberSegment(value=value)
            case SegmentType.BOOLEAN:
                return ArrayBooleanSegment(value=value)
            case SegmentType.OBJECT:
                return ArrayObjectSegment(value=value)
            case SegmentType.FILE:
                return ArrayFileSegment(value=value)
            case SegmentType.NONE:
                return ArrayAnySegment(value=value)
            case _:
                raise ValueError(f"not supported value {value}")
    raise ValueError(f"not supported value {value}")


_SEGMENT_FACTORY: Mapping[SegmentType, type[Segment]] = {
    SegmentType.NONE: NoneSegment,
    SegmentType.STRING: StringSegment,
    SegmentType.INTEGER: IntegerSegment,
    SegmentType.FLOAT: FloatSegment,
    SegmentType.FILE: FileSegment,
    SegmentType.BOOLEAN: BooleanSegment,
    SegmentType.OBJECT: ObjectSegment,
    SegmentType.ARRAY_ANY: ArrayAnySegment,
    SegmentType.ARRAY_STRING: ArrayStringSegment,
    SegmentType.ARRAY_NUMBER: ArrayNumberSegment,
    SegmentType.ARRAY_OBJECT: ArrayObjectSegment,
    SegmentType.ARRAY_FILE: ArrayFileSegment,
    SegmentType.ARRAY_BOOLEAN: ArrayBooleanSegment,
}


def build_segment_with_type(segment_type: SegmentType, value: Any) -> Segment:
    """Build a segment while enforcing compatibility with the expected runtime type."""
    if value is None:
        if segment_type == SegmentType.NONE:
            return NoneSegment()
        raise TypeMismatchError(f"Type mismatch: expected {segment_type}, but got None")

    if isinstance(value, list) and len(value) == 0:
        if segment_type == SegmentType.ARRAY_ANY:
            return ArrayAnySegment(value=value)
        if segment_type == SegmentType.ARRAY_STRING:
            return ArrayStringSegment(value=value)
        if segment_type == SegmentType.ARRAY_BOOLEAN:
            return ArrayBooleanSegment(value=value)
        if segment_type == SegmentType.ARRAY_NUMBER:
            return ArrayNumberSegment(value=value)
        if segment_type == SegmentType.ARRAY_OBJECT:
            return ArrayObjectSegment(value=value)
        if segment_type == SegmentType.ARRAY_FILE:
            return ArrayFileSegment(value=value)
        raise TypeMismatchError(f"Type mismatch: expected {segment_type}, but got empty list")

    inferred_type = SegmentType.infer_segment_type(value)
    if inferred_type is None:
        raise TypeMismatchError(
            f"Type mismatch: expected {segment_type}, but got python object, type={type(value)}, value={value}"
        )
    if inferred_type == segment_type:
        segment_class = _SEGMENT_FACTORY[segment_type]
        return segment_class(value_type=segment_type, value=value)
    if segment_type == SegmentType.NUMBER and inferred_type in (SegmentType.INTEGER, SegmentType.FLOAT):
        segment_class = _SEGMENT_FACTORY[inferred_type]
        return segment_class(value_type=inferred_type, value=value)
    raise TypeMismatchError(f"Type mismatch: expected {segment_type}, but got {inferred_type}, value={value}")


def segment_to_variable(
    *,
    segment: Segment,
    selector: Sequence[str],
    id: str | None = None,
    name: str | None = None,
    description: str = "",
) -> VariableBase:
    """Convert a runtime segment into a runtime variable for storage in the pool."""
    if isinstance(segment, VariableBase):
        return segment
    name = name or selector[-1]
    id = id or str(uuid4())

    segment_type = type(segment)
    if segment_type not in SEGMENT_TO_VARIABLE_MAP:
        raise UnsupportedSegmentTypeError(f"not supported segment type {segment_type}")

    variable_class = SEGMENT_TO_VARIABLE_MAP[segment_type]
    return cast(
        VariableBase,
        variable_class(
            id=id,
            name=name,
            description=description,
            value=segment.value,
            selector=list(selector),
        ),
    )
