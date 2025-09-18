"""
Test cases for the Loop node functionality using TableTestRunner.

This module tests the loop node's ability to:
1. Execute iterations with loop variables
2. Handle break conditions correctly
3. Update and propagate loop variables between iterations
4. Output the final loop variable value
"""

from tests.unit_tests.core.workflow.graph_engine.test_table_runner import (
    TableTestRunner,
    WorkflowTestCase,
)


def test_loop_with_break_condition():
    """
    Test loop node with break condition.

    The increment_loop_with_break_condition_workflow.yml fixture implements a loop that:
    1. Starts with num=1
    2. Increments num by 1 each iteration
    3. Breaks when num >= 5
    4. Should output {"num": 5}
    """
    runner = TableTestRunner()

    test_case = WorkflowTestCase(
        fixture_path="increment_loop_with_break_condition_workflow",
        inputs={},  # No inputs needed for this test
        expected_outputs={"num": 5},
        description="Loop with break condition when num >= 5",
    )

    result = runner.run_test_case(test_case)

    # Assert the test passed
    assert result.success, f"Test failed: {result.error}"
    assert result.actual_outputs is not None, "Should have outputs"
    assert result.actual_outputs == {"num": 5}, f"Expected {{'num': 5}}, got {result.actual_outputs}"
