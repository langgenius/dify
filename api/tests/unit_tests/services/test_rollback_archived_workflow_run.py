"""
Unit tests for workflow run rollback functionality.
"""

from datetime import datetime
from unittest.mock import MagicMock


class TestWorkflowRunRollback:
    """Tests for the WorkflowRunRollback class."""

    def test_rollback_initialization(self):
        """Rollback service should respect dry_run flag."""
        from services.rollback_archived_workflow_run import WorkflowRunRollback

        rollback = WorkflowRunRollback(dry_run=True)

        assert rollback.dry_run is True

    def test_convert_datetime_fields(self):
        """ISO datetime strings should be converted to datetime objects."""
        from models.workflow import WorkflowRun
        from services.rollback_archived_workflow_run import WorkflowRunRollback

        record = {
            "id": "test-id",
            "created_at": "2024-01-01T12:00:00",
            "finished_at": "2024-01-01T12:05:00",
            "name": "test",
        }

        rollback = WorkflowRunRollback()
        result = rollback._convert_datetime_fields(record, WorkflowRun)

        assert isinstance(result["created_at"], datetime)
        assert result["created_at"].year == 2024
        assert result["created_at"].month == 1
        assert result["name"] == "test"

    def test_restore_table_records_returns_rowcount(self):
        """Restore should return inserted rowcount."""
        from services.rollback_archived_workflow_run import WorkflowRunRollback

        session = MagicMock()
        session.execute.return_value = MagicMock(rowcount=2)

        rollback = WorkflowRunRollback()
        records = [{"id": "p1", "workflow_run_id": "r1", "created_at": "2024-01-01T00:00:00"}]

        restored = rollback._restore_table_records(session, "workflow_pauses", records)

        assert restored == 2
        session.execute.assert_called_once()

    def test_restore_table_records_unknown_table(self):
        """Unknown table names should be ignored gracefully."""
        from services.rollback_archived_workflow_run import WorkflowRunRollback

        session = MagicMock()

        rollback = WorkflowRunRollback()
        restored = rollback._restore_table_records(session, "unknown_table", [{"id": "x1"}])

        assert restored == 0
        session.execute.assert_not_called()
