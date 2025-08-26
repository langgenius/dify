#!/usr/bin/env python3
"""
Test script to verify boolean support in VariableAssigner node
"""

import sys
import os

# Add the api directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "api"))

from core.variables import SegmentType
from core.workflow.nodes.variable_assigner.v2.helpers import (
    is_operation_supported,
    is_constant_input_supported,
    is_input_value_valid,
)
from core.workflow.nodes.variable_assigner.v2.enums import Operation
from core.workflow.nodes.variable_assigner.v2.constants import EMPTY_VALUE_MAPPING


def test_boolean_operation_support():
    """Test that boolean types support the correct operations"""
    print("Testing boolean operation support...")

    # Boolean should support SET, OVER_WRITE, and CLEAR
    assert is_operation_supported(
        variable_type=SegmentType.BOOLEAN, operation=Operation.SET
    )
    assert is_operation_supported(
        variable_type=SegmentType.BOOLEAN, operation=Operation.OVER_WRITE
    )
    assert is_operation_supported(
        variable_type=SegmentType.BOOLEAN, operation=Operation.CLEAR
    )

    # Boolean should NOT support arithmetic operations
    assert not is_operation_supported(
        variable_type=SegmentType.BOOLEAN, operation=Operation.ADD
    )
    assert not is_operation_supported(
        variable_type=SegmentType.BOOLEAN, operation=Operation.SUBTRACT
    )
    assert not is_operation_supported(
        variable_type=SegmentType.BOOLEAN, operation=Operation.MULTIPLY
    )
    assert not is_operation_supported(
        variable_type=SegmentType.BOOLEAN, operation=Operation.DIVIDE
    )

    # Boolean should NOT support array operations
    assert not is_operation_supported(
        variable_type=SegmentType.BOOLEAN, operation=Operation.APPEND
    )
    assert not is_operation_supported(
        variable_type=SegmentType.BOOLEAN, operation=Operation.EXTEND
    )

    print("✓ Boolean operation support tests passed")


def test_array_boolean_operation_support():
    """Test that array boolean types support the correct operations"""
    print("Testing array boolean operation support...")

    # Array boolean should support APPEND, EXTEND, SET, OVER_WRITE, CLEAR
    assert is_operation_supported(
        variable_type=SegmentType.ARRAY_BOOLEAN, operation=Operation.APPEND
    )
    assert is_operation_supported(
        variable_type=SegmentType.ARRAY_BOOLEAN, operation=Operation.EXTEND
    )
    assert is_operation_supported(
        variable_type=SegmentType.ARRAY_BOOLEAN, operation=Operation.OVER_WRITE
    )
    assert is_operation_supported(
        variable_type=SegmentType.ARRAY_BOOLEAN, operation=Operation.CLEAR
    )
    assert is_operation_supported(
        variable_type=SegmentType.ARRAY_BOOLEAN, operation=Operation.REMOVE_FIRST
    )
    assert is_operation_supported(
        variable_type=SegmentType.ARRAY_BOOLEAN, operation=Operation.REMOVE_LAST
    )

    # Array boolean should NOT support arithmetic operations
    assert not is_operation_supported(
        variable_type=SegmentType.ARRAY_BOOLEAN, operation=Operation.ADD
    )
    assert not is_operation_supported(
        variable_type=SegmentType.ARRAY_BOOLEAN, operation=Operation.SUBTRACT
    )
    assert not is_operation_supported(
        variable_type=SegmentType.ARRAY_BOOLEAN, operation=Operation.MULTIPLY
    )
    assert not is_operation_supported(
        variable_type=SegmentType.ARRAY_BOOLEAN, operation=Operation.DIVIDE
    )

    print("✓ Array boolean operation support tests passed")


def test_boolean_constant_input_support():
    """Test that boolean types support constant input for correct operations"""
    print("Testing boolean constant input support...")

    # Boolean should support constant input for SET and OVER_WRITE
    assert is_constant_input_supported(
        variable_type=SegmentType.BOOLEAN, operation=Operation.SET
    )
    assert is_constant_input_supported(
        variable_type=SegmentType.BOOLEAN, operation=Operation.OVER_WRITE
    )

    # Boolean should NOT support constant input for arithmetic operations
    assert not is_constant_input_supported(
        variable_type=SegmentType.BOOLEAN, operation=Operation.ADD
    )

    print("✓ Boolean constant input support tests passed")


def test_boolean_input_validation():
    """Test that boolean input validation works correctly"""
    print("Testing boolean input validation...")

    # Boolean values should be valid for boolean type
    assert is_input_value_valid(
        variable_type=SegmentType.BOOLEAN, operation=Operation.SET, value=True
    )
    assert is_input_value_valid(
        variable_type=SegmentType.BOOLEAN, operation=Operation.SET, value=False
    )
    assert is_input_value_valid(
        variable_type=SegmentType.BOOLEAN, operation=Operation.OVER_WRITE, value=True
    )

    # Non-boolean values should be invalid for boolean type
    assert not is_input_value_valid(
        variable_type=SegmentType.BOOLEAN, operation=Operation.SET, value="true"
    )
    assert not is_input_value_valid(
        variable_type=SegmentType.BOOLEAN, operation=Operation.SET, value=1
    )
    assert not is_input_value_valid(
        variable_type=SegmentType.BOOLEAN, operation=Operation.SET, value=0
    )

    print("✓ Boolean input validation tests passed")


def test_array_boolean_input_validation():
    """Test that array boolean input validation works correctly"""
    print("Testing array boolean input validation...")

    # Boolean values should be valid for array boolean append
    assert is_input_value_valid(
        variable_type=SegmentType.ARRAY_BOOLEAN, operation=Operation.APPEND, value=True
    )
    assert is_input_value_valid(
        variable_type=SegmentType.ARRAY_BOOLEAN, operation=Operation.APPEND, value=False
    )

    # Boolean arrays should be valid for extend/overwrite
    assert is_input_value_valid(
        variable_type=SegmentType.ARRAY_BOOLEAN,
        operation=Operation.EXTEND,
        value=[True, False, True],
    )
    assert is_input_value_valid(
        variable_type=SegmentType.ARRAY_BOOLEAN,
        operation=Operation.OVER_WRITE,
        value=[False, False],
    )

    # Non-boolean values should be invalid
    assert not is_input_value_valid(
        variable_type=SegmentType.ARRAY_BOOLEAN,
        operation=Operation.APPEND,
        value="true",
    )
    assert not is_input_value_valid(
        variable_type=SegmentType.ARRAY_BOOLEAN,
        operation=Operation.EXTEND,
        value=[True, "false"],
    )

    print("✓ Array boolean input validation tests passed")


def test_empty_value_mapping():
    """Test that empty value mapping includes boolean types"""
    print("Testing empty value mapping...")

    # Check that boolean types have correct empty values
    assert SegmentType.BOOLEAN in EMPTY_VALUE_MAPPING
    assert EMPTY_VALUE_MAPPING[SegmentType.BOOLEAN] is False

    assert SegmentType.ARRAY_BOOLEAN in EMPTY_VALUE_MAPPING
    assert EMPTY_VALUE_MAPPING[SegmentType.ARRAY_BOOLEAN] == []

    print("✓ Empty value mapping tests passed")


def main():
    """Run all tests"""
    print("Running VariableAssigner boolean support tests...\n")

    try:
        test_boolean_operation_support()
        test_array_boolean_operation_support()
        test_boolean_constant_input_support()
        test_boolean_input_validation()
        test_array_boolean_input_validation()
        test_empty_value_mapping()

        print(
            "\n🎉 All tests passed! Boolean support has been successfully added to VariableAssigner."
        )

    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
