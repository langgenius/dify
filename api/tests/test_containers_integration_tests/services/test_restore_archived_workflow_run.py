"""
Testcontainers integration tests for workflow run restore functionality.
"""

from uuid import uuid4

from sqlalchemy import select

from models.workflow import WorkflowPause
from services.retention.workflow_run.restore_archived_workflow_run import WorkflowRunRestore


class TestWorkflowRunRestore:
    """Tests for the WorkflowRunRestore class."""

    def test_restore_table_records_returns_rowcount(self, db_session_with_containers):
        """Restore should return inserted rowcount."""
        restore = WorkflowRunRestore()
        record_id = str(uuid4())
        records = [
            {
                "id": record_id,
                "workflow_id": str(uuid4()),
                "workflow_run_id": str(uuid4()),
                "state_object_key": f"workflow-state-{uuid4()}.json",
                "created_at": "2024-01-01T00:00:00",
                "updated_at": "2024-01-01T00:00:00",
            }
        ]

        restored = restore._restore_table_records(
            db_session_with_containers,
            "workflow_pauses",
            records,
            schema_version="1.0",
        )

        assert restored == 1
        restored_pause = db_session_with_containers.scalar(select(WorkflowPause).where(WorkflowPause.id == record_id))
        assert restored_pause is not None

    def test_restore_table_records_unknown_table(self, db_session_with_containers):
        """Unknown table names should be ignored gracefully."""
        restore = WorkflowRunRestore()

        restored = restore._restore_table_records(
            db_session_with_containers,
            "unknown_table",
            [{"id": str(uuid4())}],
            schema_version="1.0",
        )

        assert restored == 0
