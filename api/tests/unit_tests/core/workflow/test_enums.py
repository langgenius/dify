"""Tests for workflow pause related enums and constants."""

from core.workflow.enums import (
    WorkflowExecutionStatus,
)


class TestWorkflowExecutionStatus:
    """Test WorkflowExecutionStatus enum."""

    def test_is_ended_method(self):
        """Test is_ended method for different statuses."""
        # Test ended statuses
        ended_statuses = [
            WorkflowExecutionStatus.SUCCEEDED,
            WorkflowExecutionStatus.FAILED,
            WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
            WorkflowExecutionStatus.STOPPED,
        ]

        for status in ended_statuses:
            assert status.is_ended(), f"{status} should be considered ended"

        # Test non-ended statuses
        non_ended_statuses = [
            WorkflowExecutionStatus.SCHEDULED,
            WorkflowExecutionStatus.RUNNING,
            WorkflowExecutionStatus.PAUSED,
        ]

        for status in non_ended_statuses:
            assert not status.is_ended(), f"{status} should not be considered ended"

    def test_ended_values(self):
        """Test ended_values returns the expected status values."""
        assert set(WorkflowExecutionStatus.ended_values()) == {
            WorkflowExecutionStatus.SUCCEEDED.value,
            WorkflowExecutionStatus.FAILED.value,
            WorkflowExecutionStatus.PARTIAL_SUCCEEDED.value,
            WorkflowExecutionStatus.STOPPED.value,
        }
