#!/usr/bin/env python3

"""
Test script to verify the boolean array comparison fix in condition processor.
"""

import sys
import os

# Add the api directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "api"))

from core.workflow.utils.condition.processor import (
    _assert_contains,
    _assert_not_contains,
)


def test_boolean_array_contains():
    """Test that boolean arrays work correctly with string comparisons."""

    # Test case 1: Boolean array [True, False, True] contains "true"
    bool_array = [True, False, True]

    # Should return True because "true" converts to True and True is in the array
    result1 = _assert_contains(value=bool_array, expected="true")
    print(f"Test 1 - [True, False, True] contains 'true': {result1}")
    assert result1 == True, "Expected True but got False"

    # Should return True because "false" converts to False and False is in the array
    result2 = _assert_contains(value=bool_array, expected="false")
    print(f"Test 2 - [True, False, True] contains 'false': {result2}")
    assert result2 == True, "Expected True but got False"

    # Test case 2: Boolean array [True, True] does not contain "false"
    bool_array2 = [True, True]
    result3 = _assert_contains(value=bool_array2, expected="false")
    print(f"Test 3 - [True, True] contains 'false': {result3}")
    assert result3 == False, "Expected False but got True"

    # Test case 3: Test not_contains
    result4 = _assert_not_contains(value=bool_array2, expected="false")
    print(f"Test 4 - [True, True] not contains 'false': {result4}")
    assert result4 == True, "Expected True but got False"

    result5 = _assert_not_contains(value=bool_array, expected="true")
    print(f"Test 5 - [True, False, True] not contains 'true': {result5}")
    assert result5 == False, "Expected False but got True"

    # Test case 4: Test with different string representations
    result6 = _assert_contains(
        value=bool_array, expected="1"
    )  # "1" should convert to True
    print(f"Test 6 - [True, False, True] contains '1': {result6}")
    assert result6 == True, "Expected True but got False"

    result7 = _assert_contains(
        value=bool_array, expected="0"
    )  # "0" should convert to False
    print(f"Test 7 - [True, False, True] contains '0': {result7}")
    assert result7 == True, "Expected True but got False"

    print("\n✅ All boolean array comparison tests passed!")


if __name__ == "__main__":
    test_boolean_array_contains()
