from unittest.mock import patch

import pytest

from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.template_transform.template_transform_node import TemplateTransformNode

from .test_table_runner import TableTestRunner, WorkflowTestCase


class TestVariableAggregator:
    """Test cases for the variable aggregator workflow."""

    @pytest.mark.parametrize(
        ("switch1", "switch2", "expected_group1", "expected_group2", "description"),
        [
            (0, 0, "switch 1 off", "switch 2 off", "Both switches off"),
            (0, 1, "switch 1 off", "switch 2 on", "Switch1 off, Switch2 on"),
            (1, 0, "switch 1 on", "switch 2 off", "Switch1 on, Switch2 off"),
            (1, 1, "switch 1 on", "switch 2 on", "Both switches on"),
        ],
    )
    def test_variable_aggregator_combinations(
        self,
        switch1: int,
        switch2: int,
        expected_group1: str,
        expected_group2: str,
        description: str,
    ) -> None:
        """Test all four combinations of switch1 and switch2."""

        def mock_template_transform_run(self):
            """Mock the TemplateTransformNode._run() method to return results based on node title."""
            title = self._node_data.title
            return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs={}, outputs={"output": title})

        with patch.object(
            TemplateTransformNode,
            "_run",
            mock_template_transform_run,
        ):
            runner = TableTestRunner()

            test_case = WorkflowTestCase(
                fixture_path="dual_switch_variable_aggregator_workflow",
                inputs={"switch1": switch1, "switch2": switch2},
                expected_outputs={"group1": expected_group1, "group2": expected_group2},
                description=description,
            )

            result = runner.run_test_case(test_case)

            assert result.success, f"Test failed: {result.error}"
            assert result.actual_outputs == test_case.expected_outputs, (
                f"Output mismatch: expected {test_case.expected_outputs}, got {result.actual_outputs}"
            )
