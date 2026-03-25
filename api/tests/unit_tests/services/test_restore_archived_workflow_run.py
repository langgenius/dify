"""
Unit tests for workflow run restore functionality.
"""

from datetime import datetime


class TestWorkflowRunRestore:
    """Tests for the WorkflowRunRestore class."""

    def test_restore_initialization(self):
        """Restore service should respect dry_run flag."""
        from services.retention.workflow_run.restore_archived_workflow_run import WorkflowRunRestore

        restore = WorkflowRunRestore(dry_run=True)

        assert restore.dry_run is True

    def test_convert_datetime_fields(self):
        """ISO datetime strings should be converted to datetime objects."""
        from models.workflow import WorkflowRun
        from services.retention.workflow_run.restore_archived_workflow_run import WorkflowRunRestore

        record = {
            "id": "test-id",
            "created_at": "2024-01-01T12:00:00",
            "finished_at": "2024-01-01T12:05:00",
            "name": "test",
        }

        restore = WorkflowRunRestore()
        result = restore._convert_datetime_fields(record, WorkflowRun)

        assert isinstance(result["created_at"], datetime)
        assert result["created_at"].year == 2024
        assert result["created_at"].month == 1
        assert result["name"] == "test"
