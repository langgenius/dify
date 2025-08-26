#!/usr/bin/env python3
"""
Simple test script to verify boolean type inference in variable factory.
"""

import sys
import os

# Add the api directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "api"))

try:
    from factories.variable_factory import build_segment, segment_to_variable
    from core.variables.segments import BooleanSegment, ArrayBooleanSegment
    from core.variables.variables import BooleanVariable, ArrayBooleanVariable
    from core.variables.types import SegmentType

    def test_boolean_inference():
        print("Testing boolean type inference...")

        # Test single boolean values
        true_segment = build_segment(True)
        false_segment = build_segment(False)

        print(f"True value: {true_segment}")
        print(f"Type: {type(true_segment)}")
        print(f"Value type: {true_segment.value_type}")
        print(f"Is BooleanSegment: {isinstance(true_segment, BooleanSegment)}")

        print(f"\nFalse value: {false_segment}")
        print(f"Type: {type(false_segment)}")
        print(f"Value type: {false_segment.value_type}")
        print(f"Is BooleanSegment: {isinstance(false_segment, BooleanSegment)}")

        # Test array of booleans
        bool_array_segment = build_segment([True, False, True])
        print(f"\nBoolean array: {bool_array_segment}")
        print(f"Type: {type(bool_array_segment)}")
        print(f"Value type: {bool_array_segment.value_type}")
        print(
            f"Is ArrayBooleanSegment: {isinstance(bool_array_segment, ArrayBooleanSegment)}"
        )

        # Test empty boolean array
        empty_bool_array = build_segment([])
        print(f"\nEmpty array: {empty_bool_array}")
        print(f"Type: {type(empty_bool_array)}")
        print(f"Value type: {empty_bool_array.value_type}")

        # Test segment to variable conversion
        bool_var = segment_to_variable(
            segment=true_segment, selector=["test", "bool_var"], name="test_boolean"
        )
        print(f"\nBoolean variable: {bool_var}")
        print(f"Type: {type(bool_var)}")
        print(f"Is BooleanVariable: {isinstance(bool_var, BooleanVariable)}")

        array_bool_var = segment_to_variable(
            segment=bool_array_segment,
            selector=["test", "array_bool_var"],
            name="test_array_boolean",
        )
        print(f"\nArray boolean variable: {array_bool_var}")
        print(f"Type: {type(array_bool_var)}")
        print(
            f"Is ArrayBooleanVariable: {isinstance(array_bool_var, ArrayBooleanVariable)}"
        )

        # Test that bool comes before int (critical ordering)
        print(f"\nTesting bool vs int precedence:")
        print(f"True is instance of bool: {isinstance(True, bool)}")
        print(f"True is instance of int: {isinstance(True, int)}")
        print(f"False is instance of bool: {isinstance(False, bool)}")
        print(f"False is instance of int: {isinstance(False, int)}")

        # Verify that boolean values are correctly inferred as boolean, not int
        assert true_segment.value_type == SegmentType.BOOLEAN, (
            "True should be inferred as BOOLEAN"
        )
        assert false_segment.value_type == SegmentType.BOOLEAN, (
            "False should be inferred as BOOLEAN"
        )
        assert bool_array_segment.value_type == SegmentType.ARRAY_BOOLEAN, (
            "Boolean array should be inferred as ARRAY_BOOLEAN"
        )

        print("\n✅ All boolean inference tests passed!")

    if __name__ == "__main__":
        test_boolean_inference()

except ImportError as e:
    print(f"Import error: {e}")
    print("Make sure you're running this from the correct directory")
except Exception as e:
    print(f"Error: {e}")
    import traceback

    traceback.print_exc()
