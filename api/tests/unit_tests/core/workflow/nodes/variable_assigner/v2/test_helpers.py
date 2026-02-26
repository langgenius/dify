import pytest

from core.variables import SegmentType
from core.workflow.nodes.variable_assigner.v2.enums import Operation
from core.workflow.nodes.variable_assigner.v2.helpers import (
    is_constant_input_supported,
    is_input_value_valid,
    is_operation_supported,
    is_variable_input_supported,
)


@pytest.mark.parametrize(
    ("variable_type", "operation", "expected"),
    [
        (SegmentType.STRING, Operation.OVER_WRITE, True),
        (SegmentType.OBJECT, Operation.SET, True),
        (SegmentType.NUMBER, Operation.ADD, True),
        (SegmentType.ARRAY_STRING, Operation.APPEND, True),
        (SegmentType.STRING, Operation.ADD, False),
        (SegmentType.BOOLEAN, Operation.DIVIDE, False),
    ],
)
def test_is_operation_supported(variable_type: SegmentType, operation: Operation, expected: bool):
    assert is_operation_supported(variable_type=variable_type, operation=operation) is expected


@pytest.mark.parametrize(
    ("operation", "expected"),
    [
        (Operation.SET, False),
        (Operation.ADD, False),
        (Operation.SUBTRACT, False),
        (Operation.MULTIPLY, False),
        (Operation.DIVIDE, False),
        (Operation.CLEAR, True),
        (Operation.OVER_WRITE, True),
    ],
)
def test_is_variable_input_supported(operation: Operation, expected: bool):
    assert is_variable_input_supported(operation=operation) is expected


@pytest.mark.parametrize(
    ("variable_type", "operation", "expected"),
    [
        (SegmentType.STRING, Operation.SET, True),
        (SegmentType.STRING, Operation.CLEAR, False),
        (SegmentType.OBJECT, Operation.OVER_WRITE, True),
        (SegmentType.BOOLEAN, Operation.SET, True),
        (SegmentType.NUMBER, Operation.DIVIDE, True),
        (SegmentType.NUMBER, Operation.EXTEND, False),
        (SegmentType.ARRAY_STRING, Operation.OVER_WRITE, False),
    ],
)
def test_is_constant_input_supported(variable_type: SegmentType, operation: Operation, expected: bool):
    assert is_constant_input_supported(variable_type=variable_type, operation=operation) is expected


def test_is_input_value_valid_overwrite_array_string():
    # Valid cases
    assert is_input_value_valid(
        variable_type=SegmentType.ARRAY_STRING, operation=Operation.OVER_WRITE, value=["hello", "world"]
    )
    assert is_input_value_valid(variable_type=SegmentType.ARRAY_STRING, operation=Operation.OVER_WRITE, value=[])

    # Invalid cases
    assert not is_input_value_valid(
        variable_type=SegmentType.ARRAY_STRING, operation=Operation.OVER_WRITE, value="not an array"
    )
    assert not is_input_value_valid(
        variable_type=SegmentType.ARRAY_STRING, operation=Operation.OVER_WRITE, value=[1, 2, 3]
    )
    assert not is_input_value_valid(
        variable_type=SegmentType.ARRAY_STRING, operation=Operation.OVER_WRITE, value=["valid", 123, "invalid"]
    )


def test_is_input_value_valid_clear_and_remove_operations_ignore_input_value():
    assert is_input_value_valid(variable_type=SegmentType.STRING, operation=Operation.CLEAR, value=None)
    assert is_input_value_valid(variable_type=SegmentType.ARRAY_STRING, operation=Operation.REMOVE_FIRST, value=None)
    assert is_input_value_valid(variable_type=SegmentType.ARRAY_STRING, operation=Operation.REMOVE_LAST, value=None)


def test_is_input_value_valid_number_divide_by_zero_and_invalid_type():
    assert is_input_value_valid(variable_type=SegmentType.NUMBER, operation=Operation.DIVIDE, value=3)
    assert not is_input_value_valid(variable_type=SegmentType.NUMBER, operation=Operation.DIVIDE, value=0)
    assert not is_input_value_valid(variable_type=SegmentType.NUMBER, operation=Operation.ADD, value="3")


def test_is_input_value_valid_object_and_boolean_types():
    assert is_input_value_valid(variable_type=SegmentType.OBJECT, operation=Operation.OVER_WRITE, value={"a": 1})
    assert not is_input_value_valid(variable_type=SegmentType.OBJECT, operation=Operation.OVER_WRITE, value="x")
    assert is_input_value_valid(variable_type=SegmentType.BOOLEAN, operation=Operation.OVER_WRITE, value=True)
    assert not is_input_value_valid(variable_type=SegmentType.BOOLEAN, operation=Operation.OVER_WRITE, value=1)


@pytest.mark.parametrize(
    ("variable_type", "operation", "value", "expected"),
    [
        (SegmentType.ARRAY_ANY, Operation.APPEND, "x", True),
        (SegmentType.ARRAY_ANY, Operation.APPEND, {"a": 1}, True),
        (SegmentType.ARRAY_ANY, Operation.EXTEND, [1, "x", {"a": 1}], True),
        (SegmentType.ARRAY_ANY, Operation.EXTEND, [True], True),
        (SegmentType.ARRAY_NUMBER, Operation.APPEND, 1.5, True),
        (SegmentType.ARRAY_NUMBER, Operation.APPEND, "1", False),
        (SegmentType.ARRAY_OBJECT, Operation.EXTEND, [{"x": 1}], True),
        (SegmentType.ARRAY_OBJECT, Operation.EXTEND, ["x"], False),
        (SegmentType.ARRAY_BOOLEAN, Operation.OVER_WRITE, [True, False], True),
        (SegmentType.ARRAY_BOOLEAN, Operation.OVER_WRITE, [True, 1], False),
    ],
)
def test_is_input_value_valid_array_variants(
    variable_type: SegmentType, operation: Operation, value: object, expected: bool
):
    assert is_input_value_valid(variable_type=variable_type, operation=operation, value=value) is expected
