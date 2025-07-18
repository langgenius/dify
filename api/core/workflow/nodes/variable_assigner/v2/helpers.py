from typing import Any

from core.variables import SegmentType

from .enums import Operation


def is_operation_supported(*, variable_type: SegmentType, operation: Operation):
    match operation:
        case Operation.OVER_WRITE | Operation.CLEAR:
            return True
        case Operation.SET:
            return variable_type in {
                SegmentType.OBJECT,
                SegmentType.STRING,
                SegmentType.NUMBER,
                SegmentType.INTEGER,
                SegmentType.FLOAT,
            }
        case Operation.ADD | Operation.SUBTRACT | Operation.MULTIPLY | Operation.DIVIDE:
            # Only number variable can be added, subtracted, multiplied or divided
            return variable_type in {SegmentType.NUMBER, SegmentType.INTEGER, SegmentType.FLOAT}
        case Operation.APPEND | Operation.EXTEND:
            # Only array variable can be appended or extended
            return variable_type in {
                SegmentType.ARRAY_ANY,
                SegmentType.ARRAY_OBJECT,
                SegmentType.ARRAY_STRING,
                SegmentType.ARRAY_NUMBER,
                SegmentType.ARRAY_FILE,
            }
        case Operation.REMOVE_FIRST | Operation.REMOVE_LAST:
            # Only array variable can have elements removed
            return variable_type in {
                SegmentType.ARRAY_ANY,
                SegmentType.ARRAY_OBJECT,
                SegmentType.ARRAY_STRING,
                SegmentType.ARRAY_NUMBER,
                SegmentType.ARRAY_FILE,
            }
        case _:
            return False


def is_variable_input_supported(*, operation: Operation):
    if operation in {Operation.SET, Operation.ADD, Operation.SUBTRACT, Operation.MULTIPLY, Operation.DIVIDE}:
        return False
    return True


def is_constant_input_supported(*, variable_type: SegmentType, operation: Operation):
    match variable_type:
        case SegmentType.STRING | SegmentType.OBJECT:
            return operation in {Operation.OVER_WRITE, Operation.SET}
        case SegmentType.NUMBER | SegmentType.INTEGER | SegmentType.FLOAT:
            return operation in {
                Operation.OVER_WRITE,
                Operation.SET,
                Operation.ADD,
                Operation.SUBTRACT,
                Operation.MULTIPLY,
                Operation.DIVIDE,
            }
        case _:
            return False


def is_input_value_valid(*, variable_type: SegmentType, operation: Operation, value: Any):
    if operation in {Operation.CLEAR, Operation.REMOVE_FIRST, Operation.REMOVE_LAST}:
        return True
    match variable_type:
        case SegmentType.STRING:
            return isinstance(value, str)

        case SegmentType.NUMBER | SegmentType.INTEGER | SegmentType.FLOAT:
            if not isinstance(value, int | float):
                return False
            if operation == Operation.DIVIDE and value == 0:
                return False
            return True

        case SegmentType.OBJECT:
            return isinstance(value, dict)

        # Array & Append
        case SegmentType.ARRAY_ANY if operation == Operation.APPEND:
            return isinstance(value, str | float | int | dict)
        case SegmentType.ARRAY_STRING if operation == Operation.APPEND:
            return isinstance(value, str)
        case SegmentType.ARRAY_NUMBER if operation == Operation.APPEND:
            return isinstance(value, int | float)
        case SegmentType.ARRAY_OBJECT if operation == Operation.APPEND:
            return isinstance(value, dict)

        # Array & Extend / Overwrite
        case SegmentType.ARRAY_ANY if operation in {Operation.EXTEND, Operation.OVER_WRITE}:
            return isinstance(value, list) and all(isinstance(item, str | float | int | dict) for item in value)
        case SegmentType.ARRAY_STRING if operation in {Operation.EXTEND, Operation.OVER_WRITE}:
            return isinstance(value, list) and all(isinstance(item, str) for item in value)
        case SegmentType.ARRAY_NUMBER if operation in {Operation.EXTEND, Operation.OVER_WRITE}:
            return isinstance(value, list) and all(isinstance(item, int | float) for item in value)
        case SegmentType.ARRAY_OBJECT if operation in {Operation.EXTEND, Operation.OVER_WRITE}:
            return isinstance(value, list) and all(isinstance(item, dict) for item in value)

        case _:
            return False
