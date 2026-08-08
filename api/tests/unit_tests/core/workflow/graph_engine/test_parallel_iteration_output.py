"""Regression tests for parallel iteration output collection."""

from __future__ import annotations

import pytest

from tests.unit_tests.core.workflow.graph_engine.test_table_runner import TableTestRunner, WorkflowTestCase


@pytest.fixture
def table_runner() -> TableTestRunner:
    return TableTestRunner(
        graph_engine_min_workers=5,
        graph_engine_max_workers=5,
        graph_engine_scale_up_threshold=1,
        graph_engine_scale_down_idle_time=3600.0,
    )


def test_sequential_iteration_fixture_output(table_runner: TableTestRunner) -> None:
    result = table_runner.run_test_case(
        WorkflowTestCase(
            fixture_path="array_iteration_formatting_workflow.yml",
            expected_outputs={"output": ["output: 1", "output: 2", "output: 3"]},
            use_auto_mock=True,
        )
    )
    assert result.success, result.error or result.validation_details


def test_parallel_iteration_fixture_output(table_runner: TableTestRunner) -> None:
    result = table_runner.run_test_case(
        WorkflowTestCase(
            fixture_path="parallel_iteration_formatting_workflow.yml",
            expected_outputs={"output": ["output: 1", "output: 2", "output: 3"]},
            description="parallel iteration formatting",
            use_auto_mock=True,
        )
    )
    assert result.success, result.error or result.validation_details


def test_parallel_iteration_fixture_output_is_stable_over_repeated_runs(
    table_runner: TableTestRunner,
) -> None:
    expected = ["output: 1", "output: 2", "output: 3"]
    for _ in range(5):
        result = table_runner.run_test_case(
            WorkflowTestCase(
                fixture_path="parallel_iteration_formatting_workflow.yml",
                expected_outputs={"output": expected},
                description="parallel iteration formatting repeated",
                use_auto_mock=True,
            )
        )
        assert result.success, result.error or result.validation_details
