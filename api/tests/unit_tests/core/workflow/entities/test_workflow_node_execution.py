"""
Unit tests for WorkflowNodeExecution domain model, focusing on process_data truncation functionality.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import pytest

from core.workflow.entities.workflow_node_execution import WorkflowNodeExecution
from core.workflow.enums import NodeType


class TestWorkflowNodeExecutionProcessDataTruncation:
    """Test process_data truncation functionality in WorkflowNodeExecution domain model."""

    def create_workflow_node_execution(
        self,
        process_data: dict[str, Any] | None = None,
    ) -> WorkflowNodeExecution:
        """Create a WorkflowNodeExecution instance for testing."""
        return WorkflowNodeExecution(
            id="test-execution-id",
            workflow_id="test-workflow-id",
            index=1,
            node_id="test-node-id",
            node_type=NodeType.LLM,
            title="Test Node",
            process_data=process_data,
            created_at=datetime.now(),
        )

    def test_initial_process_data_truncated_state(self):
        """Test that process_data_truncated returns False initially."""
        execution = self.create_workflow_node_execution()

        assert execution.process_data_truncated is False
        assert execution.get_truncated_process_data() is None

    def test_set_and_get_truncated_process_data(self):
        """Test setting and getting truncated process_data."""
        execution = self.create_workflow_node_execution()
        test_truncated_data = {"truncated": True, "key": "value"}

        execution.set_truncated_process_data(test_truncated_data)

        assert execution.process_data_truncated is True
        assert execution.get_truncated_process_data() == test_truncated_data

    def test_set_truncated_process_data_to_none(self):
        """Test setting truncated process_data to None."""
        execution = self.create_workflow_node_execution()

        # First set some data
        execution.set_truncated_process_data({"key": "value"})
        assert execution.process_data_truncated is True

        # Then set to None
        execution.set_truncated_process_data(None)
        assert execution.process_data_truncated is False
        assert execution.get_truncated_process_data() is None

    def test_get_response_process_data_with_no_truncation(self):
        """Test get_response_process_data when no truncation is set."""
        original_data = {"original": True, "data": "value"}
        execution = self.create_workflow_node_execution(process_data=original_data)

        response_data = execution.get_response_process_data()

        assert response_data == original_data
        assert execution.process_data_truncated is False

    def test_get_response_process_data_with_truncation(self):
        """Test get_response_process_data when truncation is set."""
        original_data = {"original": True, "large_data": "x" * 10000}
        truncated_data = {"original": True, "large_data": "[TRUNCATED]"}

        execution = self.create_workflow_node_execution(process_data=original_data)
        execution.set_truncated_process_data(truncated_data)

        response_data = execution.get_response_process_data()

        # Should return truncated data, not original
        assert response_data == truncated_data
        assert response_data != original_data
        assert execution.process_data_truncated is True

    def test_get_response_process_data_with_none_process_data(self):
        """Test get_response_process_data when process_data is None."""
        execution = self.create_workflow_node_execution(process_data=None)

        response_data = execution.get_response_process_data()

        assert response_data is None
        assert execution.process_data_truncated is False

    def test_consistency_with_inputs_outputs_pattern(self):
        """Test that process_data truncation follows the same pattern as inputs/outputs."""
        execution = self.create_workflow_node_execution()

        # Test that all truncation methods exist and behave consistently
        test_data = {"test": "data"}

        # Test inputs truncation
        execution.set_truncated_inputs(test_data)
        assert execution.inputs_truncated is True
        assert execution.get_truncated_inputs() == test_data

        # Test outputs truncation
        execution.set_truncated_outputs(test_data)
        assert execution.outputs_truncated is True
        assert execution.get_truncated_outputs() == test_data

        # Test process_data truncation
        execution.set_truncated_process_data(test_data)
        assert execution.process_data_truncated is True
        assert execution.get_truncated_process_data() == test_data

    @pytest.mark.parametrize(
        "test_data",
        [
            {"simple": "value"},
            {"nested": {"key": "value"}},
            {"list": [1, 2, 3]},
            {"mixed": {"string": "value", "number": 42, "list": [1, 2]}},
            {},  # empty dict
        ],
    )
    def test_truncated_process_data_with_various_data_types(self, test_data):
        """Test that truncated process_data works with various data types."""
        execution = self.create_workflow_node_execution()

        execution.set_truncated_process_data(test_data)

        assert execution.process_data_truncated is True
        assert execution.get_truncated_process_data() == test_data
        assert execution.get_response_process_data() == test_data


@dataclass
class ProcessDataScenario:
    """Test scenario data for process_data functionality."""

    name: str
    original_data: dict[str, Any] | None
    truncated_data: dict[str, Any] | None
    expected_truncated_flag: bool
    expected_response_data: dict[str, Any] | None


class TestWorkflowNodeExecutionProcessDataScenarios:
    """Test various scenarios for process_data handling."""

    def get_process_data_scenarios(self) -> list[ProcessDataScenario]:
        """Create test scenarios for process_data functionality."""
        return [
            ProcessDataScenario(
                name="no_process_data",
                original_data=None,
                truncated_data=None,
                expected_truncated_flag=False,
                expected_response_data=None,
            ),
            ProcessDataScenario(
                name="process_data_without_truncation",
                original_data={"small": "data"},
                truncated_data=None,
                expected_truncated_flag=False,
                expected_response_data={"small": "data"},
            ),
            ProcessDataScenario(
                name="process_data_with_truncation",
                original_data={"large": "x" * 10000, "metadata": "info"},
                truncated_data={"large": "[TRUNCATED]", "metadata": "info"},
                expected_truncated_flag=True,
                expected_response_data={"large": "[TRUNCATED]", "metadata": "info"},
            ),
            ProcessDataScenario(
                name="empty_process_data",
                original_data={},
                truncated_data=None,
                expected_truncated_flag=False,
                expected_response_data={},
            ),
            ProcessDataScenario(
                name="complex_nested_data_with_truncation",
                original_data={
                    "config": {"setting": "value"},
                    "logs": ["log1", "log2"] * 1000,  # Large list
                    "status": "running",
                },
                truncated_data={"config": {"setting": "value"}, "logs": "[TRUNCATED: 2000 items]", "status": "running"},
                expected_truncated_flag=True,
                expected_response_data={
                    "config": {"setting": "value"},
                    "logs": "[TRUNCATED: 2000 items]",
                    "status": "running",
                },
            ),
        ]

    @pytest.mark.parametrize(
        "scenario",
        get_process_data_scenarios(None),
        ids=[scenario.name for scenario in get_process_data_scenarios(None)],
    )
    def test_process_data_scenarios(self, scenario: ProcessDataScenario):
        """Test various process_data scenarios."""
        execution = WorkflowNodeExecution(
            id="test-execution-id",
            workflow_id="test-workflow-id",
            index=1,
            node_id="test-node-id",
            node_type=NodeType.LLM,
            title="Test Node",
            process_data=scenario.original_data,
            created_at=datetime.now(),
        )

        if scenario.truncated_data is not None:
            execution.set_truncated_process_data(scenario.truncated_data)

        assert execution.process_data_truncated == scenario.expected_truncated_flag
        assert execution.get_response_process_data() == scenario.expected_response_data
