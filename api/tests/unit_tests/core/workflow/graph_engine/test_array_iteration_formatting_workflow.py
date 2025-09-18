from .test_table_runner import TableTestRunner, WorkflowTestCase


def test_array_iteration_formatting_workflow():
    """
    Validate Iteration node processes [1,2,3] into formatted strings.

    Fixture description expects:
    {"output": ["output: 1", "output: 2", "output: 3"]}
    """
    runner = TableTestRunner()

    test_case = WorkflowTestCase(
        fixture_path="array_iteration_formatting_workflow",
        inputs={},
        expected_outputs={"output": ["output: 1", "output: 2", "output: 3"]},
        description="Iteration formats numbers into strings",
        use_auto_mock=True,
    )

    result = runner.run_test_case(test_case)

    assert result.success, f"Iteration workflow failed: {result.error}"
    assert result.actual_outputs == test_case.expected_outputs
