"""
Test cases for the Iteration node's flatten_output functionality.

This module tests the iteration node's ability to:
1. Flatten array outputs when flatten_output=True (default)
2. Preserve nested array structure when flatten_output=False
"""

from .test_table_runner import TableTestRunner, WorkflowTestCase


def test_iteration_with_flatten_output_enabled():
    """
    Test iteration node with flatten_output=True (default behavior).

    The fixture implements an iteration that:
    1. Iterates over [1, 2, 3]
    2. For each item, outputs [item, item*2]
    3. With flatten_output=True, should output [1, 2, 2, 4, 3, 6]
    """
    runner = TableTestRunner()

    test_case = WorkflowTestCase(
        fixture_path="iteration_flatten_output_enabled_workflow",
        inputs={},
        expected_outputs={"output": [1, 2, 2, 4, 3, 6]},
        description="Iteration with flatten_output=True flattens nested arrays",
        use_auto_mock=False,  # Run code nodes directly
    )

    result = runner.run_test_case(test_case)

    assert result.success, f"Test failed: {result.error}"
    assert result.actual_outputs is not None, "Should have outputs"
    assert result.actual_outputs == {"output": [1, 2, 2, 4, 3, 6]}, (
        f"Expected flattened output [1, 2, 2, 4, 3, 6], got {result.actual_outputs}"
    )


def test_iteration_with_flatten_output_disabled():
    """
    Test iteration node with flatten_output=False.

    The fixture implements an iteration that:
    1. Iterates over [1, 2, 3]
    2. For each item, outputs [item, item*2]
    3. With flatten_output=False, should output [[1, 2], [2, 4], [3, 6]]
    """
    runner = TableTestRunner()

    test_case = WorkflowTestCase(
        fixture_path="iteration_flatten_output_disabled_workflow",
        inputs={},
        expected_outputs={"output": [[1, 2], [2, 4], [3, 6]]},
        description="Iteration with flatten_output=False preserves nested structure",
        use_auto_mock=False,  # Run code nodes directly
    )

    result = runner.run_test_case(test_case)

    assert result.success, f"Test failed: {result.error}"
    assert result.actual_outputs is not None, "Should have outputs"
    assert result.actual_outputs == {"output": [[1, 2], [2, 4], [3, 6]]}, (
        f"Expected nested output [[1, 2], [2, 4], [3, 6]], got {result.actual_outputs}"
    )


def test_iteration_flatten_output_comparison():
    """
    Run both flatten_output configurations in parallel to verify the difference.
    """
    runner = TableTestRunner()

    test_cases = [
        WorkflowTestCase(
            fixture_path="iteration_flatten_output_enabled_workflow",
            inputs={},
            expected_outputs={"output": [1, 2, 2, 4, 3, 6]},
            description="flatten_output=True: Flattened output",
            use_auto_mock=False,  # Run code nodes directly
        ),
        WorkflowTestCase(
            fixture_path="iteration_flatten_output_disabled_workflow",
            inputs={},
            expected_outputs={"output": [[1, 2], [2, 4], [3, 6]]},
            description="flatten_output=False: Nested output",
            use_auto_mock=False,  # Run code nodes directly
        ),
    ]

    suite_result = runner.run_table_tests(test_cases, parallel=True)

    # Assert all tests passed
    assert suite_result.passed_tests == 2, f"Expected 2 passed tests, got {suite_result.passed_tests}"
    assert suite_result.failed_tests == 0, f"Expected 0 failed tests, got {suite_result.failed_tests}"
    assert suite_result.success_rate == 100.0, f"Expected 100% success rate, got {suite_result.success_rate}"
