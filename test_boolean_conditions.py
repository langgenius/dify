#!/usr/bin/env python3
"""
Simple test script to verify boolean condition support in IfElseNode
"""

import sys
import os

# Add the api directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "api"))

from core.workflow.utils.condition.processor import (
    ConditionProcessor,
    _evaluate_condition,
)


def test_boolean_conditions():
    """Test boolean condition evaluation"""
    print("Testing boolean condition support...")

    # Test boolean "is" operator
    result = _evaluate_condition(value=True, operator="is", expected="true")
    assert result == True, f"Expected True, got {result}"
    print("✓ Boolean 'is' with True value passed")

    result = _evaluate_condition(value=False, operator="is", expected="false")
    assert result == True, f"Expected True, got {result}"
    print("✓ Boolean 'is' with False value passed")

    # Test boolean "is not" operator
    result = _evaluate_condition(value=True, operator="is not", expected="false")
    assert result == True, f"Expected True, got {result}"
    print("✓ Boolean 'is not' with True value passed")

    result = _evaluate_condition(value=False, operator="is not", expected="true")
    assert result == True, f"Expected True, got {result}"
    print("✓ Boolean 'is not' with False value passed")

    # Test boolean "=" operator
    result = _evaluate_condition(value=True, operator="=", expected="1")
    assert result == True, f"Expected True, got {result}"
    print("✓ Boolean '=' with True=1 passed")

    result = _evaluate_condition(value=False, operator="=", expected="0")
    assert result == True, f"Expected True, got {result}"
    print("✓ Boolean '=' with False=0 passed")

    # Test boolean "≠" operator
    result = _evaluate_condition(value=True, operator="≠", expected="0")
    assert result == True, f"Expected True, got {result}"
    print("✓ Boolean '≠' with True≠0 passed")

    result = _evaluate_condition(value=False, operator="≠", expected="1")
    assert result == True, f"Expected True, got {result}"
    print("✓ Boolean '≠' with False≠1 passed")

    # Test boolean "in" operator
    result = _evaluate_condition(value=True, operator="in", expected=["true", "false"])
    assert result == True, f"Expected True, got {result}"
    print("✓ Boolean 'in' with True in array passed")

    result = _evaluate_condition(value=False, operator="in", expected=["true", "false"])
    assert result == True, f"Expected True, got {result}"
    print("✓ Boolean 'in' with False in array passed")

    # Test boolean "not in" operator
    result = _evaluate_condition(value=True, operator="not in", expected=["false", "0"])
    assert result == True, f"Expected True, got {result}"
    print("✓ Boolean 'not in' with True not in [false, 0] passed")

    # Test boolean "null" and "not null" operators
    result = _evaluate_condition(value=True, operator="not null", expected=None)
    assert result == True, f"Expected True, got {result}"
    print("✓ Boolean 'not null' with True passed")

    result = _evaluate_condition(value=False, operator="not null", expected=None)
    assert result == True, f"Expected True, got {result}"
    print("✓ Boolean 'not null' with False passed")

    print("\n🎉 All boolean condition tests passed!")


def test_backward_compatibility():
    """Test that existing string and number conditions still work"""
    print("\nTesting backward compatibility...")

    # Test string conditions
    result = _evaluate_condition(value="hello", operator="is", expected="hello")
    assert result == True, f"Expected True, got {result}"
    print("✓ String 'is' condition still works")

    result = _evaluate_condition(value="hello", operator="contains", expected="ell")
    assert result == True, f"Expected True, got {result}"
    print("✓ String 'contains' condition still works")

    # Test number conditions
    result = _evaluate_condition(value=42, operator="=", expected="42")
    assert result == True, f"Expected True, got {result}"
    print("✓ Number '=' condition still works")

    result = _evaluate_condition(value=42, operator=">", expected="40")
    assert result == True, f"Expected True, got {result}"
    print("✓ Number '>' condition still works")

    print("✓ Backward compatibility maintained!")


if __name__ == "__main__":
    try:
        test_boolean_conditions()
        test_backward_compatibility()
        print(
            "\n✅ All tests passed! Boolean support has been successfully added to IfElseNode."
        )
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        sys.exit(1)
