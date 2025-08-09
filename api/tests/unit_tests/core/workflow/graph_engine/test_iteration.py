from .test_graph_engine import TableTestRunner, WorkflowTestCase


def test_simple_iteration_outputs():
    """
    Validate Iteration node processes [1,2,3] into formatted strings.

    Fixture description expects:
    {"output": ["output: 1", "output: 2", "output: 3"]}
    """
    runner = TableTestRunner()

    test_case = WorkflowTestCase(
        fixture_path="test_iteration",
        inputs={},
        expected_outputs={"output": ["output: 1", "output: 2", "output: 3"]},
        description="Iteration formats numbers into strings",
    )

    result = runner.run_test_case(test_case)

    assert result.success, f"Iteration workflow failed: {result.error}"
    assert result.actual_outputs == test_case.expected_outputs
