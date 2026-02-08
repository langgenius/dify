"""
Unit tests for workflow run restore functionality.
"""

from datetime import datetime
from unittest.mock import MagicMock


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

    def test_restore_table_records_returns_rowcount(self):
        """Restore should return inserted rowcount."""
        from services.retention.workflow_run.restore_archived_workflow_run import WorkflowRunRestore

        session = MagicMock()
        session.execute.return_value = MagicMock(rowcount=2)

        restore = WorkflowRunRestore()
        records = [{"id": "p1", "workflow_run_id": "r1", "created_at": "2024-01-01T00:00:00"}]

        restored = restore._restore_table_records(session, "workflow_pauses", records, schema_version="1.0")

        assert restored == 2
        session.execute.assert_called_once()

    def test_restore_table_records_unknown_table(self):
        """Unknown table names should be ignored gracefully."""
        from services.retention.workflow_run.restore_archived_workflow_run import WorkflowRunRestore

        session = MagicMock()

        restore = WorkflowRunRestore()
        restored = restore._restore_table_records(session, "unknown_table", [{"id": "x1"}], schema_version="1.0")

        assert restored == 0
        session.execute.assert_not_called()
