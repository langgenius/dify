from collections.abc import Mapping, Sequence
from typing import Any, cast
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
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID, ENVIRONMENT_VARIABLE_NODE_ID


class UnsupportedSegmentTypeError(Exception):
    pass


class TypeMismatchError(Exception):
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


def build_conversation_variable_from_mapping(mapping: Mapping[str, Any], /) -> Variable:
    if not mapping.get("name"):
        raise VariableError("missing name")
    return _build_variable_from_mapping(mapping=mapping, selector=[CONVERSATION_VARIABLE_NODE_ID, mapping["name"]])


def build_environment_variable_from_mapping(mapping: Mapping[str, Any], /) -> Variable:
    if not mapping.get("name"):
        raise VariableError("missing name")
    return _build_variable_from_mapping(mapping=mapping, selector=[ENVIRONMENT_VARIABLE_NODE_ID, mapping["name"]])


def _build_variable_from_mapping(*, mapping: Mapping[str, Any], selector: Sequence[str]) -> Variable:
    """
    This factory function is used to create the environment variable or the conversation variable,
    not support the File type.
    """
    if (value_type := mapping.get("value_type")) is None:
        raise VariableError("missing value type")
    if (value := mapping.get("value")) is None:
        raise VariableError("missing value")

    result: Variable
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
    if not result.selector:
        result = result.model_copy(update={"selector": selector})
    return cast(Variable, result)


def infer_segment_type_from_value(value: Any, /) -> SegmentType:
    return build_segment(value).value_type


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
                # This should be unreachable.
                raise ValueError(f"not supported value {value}")
    raise ValueError(f"not supported value {value}")


def build_segment_with_type(segment_type: SegmentType, value: Any) -> Segment:
    """
    Build a segment with explicit type checking.

    This function creates a segment from a value while enforcing type compatibility
    with the specified segment_type. It provides stricter type validation compared
    to the standard build_segment function.

    Args:
        segment_type: The expected SegmentType for the resulting segment
        value: The value to be converted into a segment

    Returns:
        Segment: A segment instance of the appropriate type

    Raises:
        TypeMismatchError: If the value type doesn't match the expected segment_type

    Special Cases:
        - For empty list [] values, if segment_type is array[*], returns the corresponding array type
        - Type validation is performed before segment creation

    Examples:
        >>> build_segment_with_type(SegmentType.STRING, "hello")
        StringSegment(value="hello")

        >>> build_segment_with_type(SegmentType.ARRAY_STRING, [])
        ArrayStringSegment(value=[])

        >>> build_segment_with_type(SegmentType.STRING, 123)
        # Raises TypeMismatchError
    """
    # Handle None values
    if value is None:
        if segment_type == SegmentType.NONE:
            return NoneSegment()
        else:
            raise TypeMismatchError(f"Expected {segment_type}, but got None")

    # Handle empty list special case for array types
    if isinstance(value, list) and len(value) == 0:
        if segment_type == SegmentType.ARRAY_ANY:
            return ArrayAnySegment(value=value)
        elif segment_type == SegmentType.ARRAY_STRING:
            return ArrayStringSegment(value=value)
        elif segment_type == SegmentType.ARRAY_NUMBER:
            return ArrayNumberSegment(value=value)
        elif segment_type == SegmentType.ARRAY_OBJECT:
            return ArrayObjectSegment(value=value)
        elif segment_type == SegmentType.ARRAY_FILE:
            return ArrayFileSegment(value=value)
        else:
            raise TypeMismatchError(f"Expected {segment_type}, but got empty list")

    # Build segment using existing logic to infer actual type
    inferred_segment = build_segment(value)
    inferred_type = inferred_segment.value_type

    # Type compatibility checking
    if inferred_type == segment_type:
        return inferred_segment

    # Type mismatch - raise error with descriptive message
    raise TypeMismatchError(
        f"Type mismatch: expected {segment_type}, but value '{value}' "
        f"(type: {type(value).__name__}) corresponds to {inferred_type}"
    )


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
    return cast(
        Variable,
        variable_class(
            id=id,
            name=name,
            description=description,
            value=segment.value,
            selector=selector,
        ),
    )
