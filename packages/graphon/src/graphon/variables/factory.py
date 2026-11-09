"""Graph-owned helpers for converting runtime values, segments, and variables.

These conversions are part of the `graphon` runtime model and must stay
independent from top-level API factory modules so graph nodes and state
containers can operate without importing application-layer packages.
"""

from collections.abc import Mapping, Sequence
from typing import Any
from uuid import uuid4

from graphon.file.models import File

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
    SecretVariable,
    StringVariable,
    Variable,
    VariableBase,
)


class UnsupportedSegmentTypeError(Exception):
    pass


class TypeMismatchError(Exception):
    pass


_NUMERICAL_SEGMENT_TYPES = frozenset((
    SegmentType.NUMBER,
    SegmentType.INTEGER,
    SegmentType.FLOAT,
))


def _build_uniform_array_segment(
    *,
    element_type: SegmentType,
    value: list[Any],
) -> Segment:
    match element_type:
        case SegmentType.STRING:
            result: Segment = ArrayStringSegment(value=value)
        case SegmentType.NUMBER | SegmentType.INTEGER | SegmentType.FLOAT:
            result = ArrayNumberSegment(value=value)
        case SegmentType.BOOLEAN:
            result = ArrayBooleanSegment(value=value)
        case SegmentType.OBJECT:
            result = ArrayObjectSegment(value=value)
        case SegmentType.FILE:
            result = ArrayFileSegment(value=value)
        case SegmentType.NONE:
            result = ArrayAnySegment(value=value)
        case _:
            msg = f"not supported value {value}"
            raise ValueError(msg)
    return result


def _build_empty_array_segment_for_type(
    *,
    segment_type: SegmentType,
    value: list[Any],
) -> Segment | None:
    match segment_type:
        case SegmentType.ARRAY_ANY:
            result: Segment | None = ArrayAnySegment(value=value)
        case SegmentType.ARRAY_STRING:
            result = ArrayStringSegment(value=value)
        case SegmentType.ARRAY_BOOLEAN:
            result = ArrayBooleanSegment(value=value)
        case SegmentType.ARRAY_NUMBER:
            result = ArrayNumberSegment(value=value)
        case SegmentType.ARRAY_OBJECT:
            result = ArrayObjectSegment(value=value)
        case SegmentType.ARRAY_FILE:
            result = ArrayFileSegment(value=value)
        case _:
            result = None
    return result


def _existing_variable_from_segment(segment: VariableBase) -> Variable:
    if isinstance(
        segment,
        (
            ArrayAnyVariable,
            ArrayBooleanVariable,
            ArrayFileVariable,
            ArrayNumberVariable,
            ArrayObjectVariable,
            ArrayStringVariable,
        ),
    ):
        return segment
    if isinstance(
        segment,
        (
            BooleanVariable,
            FileVariable,
            FloatVariable,
            IntegerVariable,
            NoneVariable,
            ObjectVariable,
            SecretVariable,
            StringVariable,
        ),
    ):
        return segment
    msg = f"not supported segment type {type(segment)}"
    raise UnsupportedSegmentTypeError(msg)


def _build_array_variable(
    *,
    segment: Segment,
    variable_id: str,
    name: str,
    description: str,
    selector: list[str],
) -> Variable:
    match segment:
        case ArrayAnySegment():
            result: Variable = ArrayAnyVariable(
                id=variable_id,
                name=name,
                description=description,
                value=segment.value,
                selector=selector,
            )
        case ArrayBooleanSegment():
            result = ArrayBooleanVariable(
                id=variable_id,
                name=name,
                description=description,
                value=segment.value,
                selector=selector,
            )
        case ArrayFileSegment():
            result = ArrayFileVariable(
                id=variable_id,
                name=name,
                description=description,
                value=segment.value,
                selector=selector,
            )
        case ArrayNumberSegment():
            result = ArrayNumberVariable(
                id=variable_id,
                name=name,
                description=description,
                value=segment.value,
                selector=selector,
            )
        case ArrayObjectSegment():
            result = ArrayObjectVariable(
                id=variable_id,
                name=name,
                description=description,
                value=segment.value,
                selector=selector,
            )
        case ArrayStringSegment():
            result = ArrayStringVariable(
                id=variable_id,
                name=name,
                description=description,
                value=segment.value,
                selector=selector,
            )
        case _:
            msg = f"not supported segment type {type(segment)}"
            raise UnsupportedSegmentTypeError(msg)
    return result


def _build_scalar_variable(
    *,
    segment: Segment,
    variable_id: str,
    name: str,
    description: str,
    selector: list[str],
) -> Variable:
    match segment:
        case BooleanSegment():
            result: Variable = BooleanVariable(
                id=variable_id,
                name=name,
                description=description,
                value=segment.value,
                selector=selector,
            )
        case FileSegment():
            result = FileVariable(
                id=variable_id,
                name=name,
                description=description,
                value=segment.value,
                selector=selector,
            )
        case FloatSegment():
            result = FloatVariable(
                id=variable_id,
                name=name,
                description=description,
                value=segment.value,
                selector=selector,
            )
        case IntegerSegment():
            result = IntegerVariable(
                id=variable_id,
                name=name,
                description=description,
                value=segment.value,
                selector=selector,
            )
        case NoneSegment():
            result = NoneVariable(
                id=variable_id,
                name=name,
                description=description,
                selector=selector,
            )
        case ObjectSegment():
            result = ObjectVariable(
                id=variable_id,
                name=name,
                description=description,
                value=segment.value,
                selector=selector,
            )
        case StringSegment():
            result = StringVariable(
                id=variable_id,
                name=name,
                description=description,
                value=segment.value,
                selector=selector,
            )
        case _:
            msg = f"not supported segment type {type(segment)}"
            raise UnsupportedSegmentTypeError(msg)
    return result


def _build_non_list_segment(value: Any) -> Segment | None:
    match value:
        case None:
            segment = NoneSegment()
        case Segment():
            segment = value
        case str():
            segment = StringSegment(value=value)
        case bool():
            segment = BooleanSegment(value=value)
        case int():
            segment = IntegerSegment(value=value)
        case float():
            segment = FloatSegment(value=value)
        case dict():
            segment = ObjectSegment(value=value)
        case File():
            segment = FileSegment(value=value)
        case _:
            segment = None
    return segment


def _build_list_segment(value: list[Any]) -> Segment:
    items = [build_segment(item) for item in value]
    types = {item.value_type for item in items}

    if all(isinstance(item, ArraySegment) for item in items):
        return ArrayAnySegment(value=value)
    if len(types) != 1:
        return (
            ArrayNumberSegment(value=value)
            if types.issubset(_NUMERICAL_SEGMENT_TYPES)
            else ArrayAnySegment(value=value)
        )

    return _build_uniform_array_segment(element_type=types.pop(), value=value)


def _build_empty_array_segment(
    *,
    segment_type: SegmentType,
    value: list[Any],
) -> Segment | None:
    return _build_empty_array_segment_for_type(
        segment_type=segment_type,
        value=value,
    )


def _resolve_segment_class_for_type_match(
    *,
    segment_type: SegmentType,
    inferred_type: SegmentType,
) -> type[Segment] | None:
    if inferred_type == segment_type:
        return _SEGMENT_FACTORY[segment_type]
    if segment_type == SegmentType.NUMBER and inferred_type in frozenset((
        SegmentType.INTEGER,
        SegmentType.FLOAT,
    )):
        return _SEGMENT_FACTORY[inferred_type]
    return None


def build_segment(value: Any, /) -> Segment:
    """Build a runtime segment from a Python value."""
    segment = _build_non_list_segment(value)
    if segment is not None:
        return segment
    if isinstance(value, list):
        return _build_list_segment(value)
    msg = f"not supported value {value}"
    raise ValueError(msg)


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
        msg = f"Type mismatch: expected {segment_type}, but got None"
        raise TypeMismatchError(msg)

    if isinstance(value, list) and len(value) == 0:
        empty_segment = _build_empty_array_segment(
            segment_type=segment_type,
            value=value,
        )
        if empty_segment is not None:
            return empty_segment
        msg = f"Type mismatch: expected {segment_type}, but got empty list"
        raise TypeMismatchError(msg)

    inferred_type = SegmentType.infer_segment_type(value)
    if inferred_type is None:
        msg = (
            f"Type mismatch: expected {segment_type}, but got python object, "
            f"type={type(value)}, value={value}"
        )
        raise TypeMismatchError(msg)

    segment_class = _resolve_segment_class_for_type_match(
        segment_type=segment_type,
        inferred_type=inferred_type,
    )
    if segment_class is not None:
        value_type = (
            inferred_type if segment_type == SegmentType.NUMBER else segment_type
        )
        return segment_class(value_type=value_type, value=value)
    msg = (
        f"Type mismatch: expected {segment_type}, but got {inferred_type}, "
        f"value={value}"
    )
    raise TypeMismatchError(msg)


def segment_to_variable(
    *,
    segment: Segment,
    selector: Sequence[str],
    variable_id: str | None = None,
    name: str | None = None,
    description: str = "",
) -> Variable:
    """Convert a runtime segment into a runtime variable for storage in the pool."""
    if isinstance(segment, VariableBase):
        return _existing_variable_from_segment(segment)
    name = name or selector[-1]
    resolved_variable_id = variable_id or str(uuid4())
    resolved_selector = list(selector)
    if isinstance(segment, ArraySegment):
        return _build_array_variable(
            segment=segment,
            variable_id=resolved_variable_id,
            name=name,
            description=description,
            selector=resolved_selector,
        )
    return _build_scalar_variable(
        segment=segment,
        variable_id=resolved_variable_id,
        name=name,
        description=description,
        selector=resolved_selector,
    )
