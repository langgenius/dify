from typing import Any, assert_never

from graphon.variables.types import SegmentType

from .enums import Operation

_NO_VALUE_OPERATIONS = frozenset((
    Operation.CLEAR,
    Operation.REMOVE_FIRST,
    Operation.REMOVE_LAST,
))
_LIST_VALUE_OPERATIONS = frozenset((Operation.EXTEND, Operation.OVER_WRITE))
_NUMERIC_SEGMENT_TYPES = frozenset((
    SegmentType.NUMBER,
    SegmentType.INTEGER,
    SegmentType.FLOAT,
))
_SCALAR_INPUT_TYPES: dict[SegmentType, type[Any]] = {
    SegmentType.STRING: str,
    SegmentType.BOOLEAN: bool,
    SegmentType.OBJECT: dict,
}
_ARRAY_APPEND_INPUT_TYPES: dict[
    SegmentType,
    type[Any] | tuple[type[Any], ...],
] = {
    SegmentType.ARRAY_ANY: (str, float, int, dict),
    SegmentType.ARRAY_STRING: str,
    SegmentType.ARRAY_NUMBER: (int, float),
    SegmentType.ARRAY_OBJECT: dict,
    SegmentType.ARRAY_BOOLEAN: bool,
}
_ARRAY_LIST_INPUT_TYPES = dict(_ARRAY_APPEND_INPUT_TYPES)


def _is_valid_list_input(
    value: Any,
    item_type: type[Any] | tuple[type[Any], ...],
) -> bool:
    match value:
        case list() if all(isinstance(item, item_type) for item in value):
            result = True
        case _:
            result = False
    return result


def _is_valid_numeric_input(*, operation: Operation, value: Any) -> bool:
    match value:
        case int() | float():
            result = not (operation == Operation.DIVIDE and value == 0)
        case _:
            result = False
    return result


def is_operation_supported(
    *,
    variable_type: SegmentType,
    operation: Operation,
) -> bool:
    match operation:
        case Operation.OVER_WRITE | Operation.CLEAR:
            return True
        case Operation.SET:
            return variable_type in frozenset((
                SegmentType.OBJECT,
                SegmentType.STRING,
                SegmentType.NUMBER,
                SegmentType.INTEGER,
                SegmentType.FLOAT,
                SegmentType.BOOLEAN,
            ))
        case Operation.ADD | Operation.SUBTRACT | Operation.MULTIPLY | Operation.DIVIDE:
            # Only number variable can be added, subtracted, multiplied or divided
            return variable_type in frozenset((
                SegmentType.NUMBER,
                SegmentType.INTEGER,
                SegmentType.FLOAT,
            ))
        case (
            Operation.APPEND
            | Operation.EXTEND
            | Operation.REMOVE_FIRST
            | Operation.REMOVE_LAST
        ):
            # Only array variable can be appended or extended
            # Only array variable can have elements removed
            return variable_type.is_array_type()
        case _:
            assert_never(operation)


def is_variable_input_supported(*, operation: Operation) -> bool:
    return operation not in frozenset((
        Operation.SET,
        Operation.ADD,
        Operation.SUBTRACT,
        Operation.MULTIPLY,
        Operation.DIVIDE,
    ))


def is_constant_input_supported(
    *,
    variable_type: SegmentType,
    operation: Operation,
) -> bool:
    match variable_type:
        case SegmentType.STRING | SegmentType.OBJECT | SegmentType.BOOLEAN:
            return operation in frozenset((Operation.OVER_WRITE, Operation.SET))
        case SegmentType.NUMBER | SegmentType.INTEGER | SegmentType.FLOAT:
            return operation in frozenset((
                Operation.OVER_WRITE,
                Operation.SET,
                Operation.ADD,
                Operation.SUBTRACT,
                Operation.MULTIPLY,
                Operation.DIVIDE,
            ))
        case _:
            return False


def is_input_value_valid(
    *,
    variable_type: SegmentType,
    operation: Operation,
    value: Any,
) -> bool:
    if operation in _NO_VALUE_OPERATIONS:
        return True
    if variable_type in _NUMERIC_SEGMENT_TYPES:
        return _is_valid_numeric_input(operation=operation, value=value)
    if _is_valid_scalar_input(variable_type=variable_type, value=value):
        return True
    return _is_valid_array_input(
        variable_type=variable_type,
        operation=operation,
        value=value,
    )


def _is_valid_scalar_input(*, variable_type: SegmentType, value: Any) -> bool:
    input_type = _SCALAR_INPUT_TYPES.get(variable_type)
    return input_type is not None and isinstance(value, input_type)


def _is_valid_array_input(
    *,
    variable_type: SegmentType,
    operation: Operation,
    value: Any,
) -> bool:
    if operation == Operation.APPEND:
        input_type = _ARRAY_APPEND_INPUT_TYPES.get(variable_type)
        return input_type is not None and isinstance(value, input_type)
    if operation in _LIST_VALUE_OPERATIONS:
        input_type = _ARRAY_LIST_INPUT_TYPES.get(variable_type)
        return input_type is not None and _is_valid_list_input(value, input_type)
    return False
