from core.variables import SegmentType
from core.workflow.nodes.variable_assigner.v2.enums import Operation
from core.workflow.nodes.variable_assigner.v2.helpers import is_input_value_valid


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
