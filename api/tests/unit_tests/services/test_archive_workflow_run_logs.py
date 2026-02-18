"""
Unit tests for workflow run archiving functionality.

This module contains tests for:
- Archive service
- Rollback service
"""

from datetime import datetime
from unittest.mock import MagicMock, patch

from services.retention.workflow_run.constants import ARCHIVE_BUNDLE_NAME


class TestWorkflowRunArchiver:
    """Tests for the WorkflowRunArchiver class."""

    @patch("services.retention.workflow_run.archive_paid_plan_workflow_run.dify_config")
    @patch("services.retention.workflow_run.archive_paid_plan_workflow_run.get_archive_storage")
    def test_archiver_initialization(self, mock_get_storage, mock_config):
        """Test archiver can be initialized with various options."""
        from services.retention.workflow_run.archive_paid_plan_workflow_run import WorkflowRunArchiver

        mock_config.BILLING_ENABLED = False

        archiver = WorkflowRunArchiver(
            days=90,
            batch_size=100,
            tenant_ids=["test-tenant"],
            limit=50,
            dry_run=True,
        )

        assert archiver.days == 90
        assert archiver.batch_size == 100
        assert archiver.tenant_ids == ["test-tenant"]
        assert archiver.limit == 50
        assert archiver.dry_run is True

    def test_get_archive_key(self):
        """Test archive key generation."""
        from services.retention.workflow_run.archive_paid_plan_workflow_run import WorkflowRunArchiver

        archiver = WorkflowRunArchiver.__new__(WorkflowRunArchiver)

        mock_run = MagicMock()
        mock_run.tenant_id = "tenant-123"
        mock_run.app_id = "app-999"
        mock_run.id = "run-456"
        mock_run.created_at = datetime(2024, 1, 15, 12, 0, 0)

        key = archiver._get_archive_key(mock_run)

        assert key == f"tenant-123/app_id=app-999/year=2024/month=01/workflow_run_id=run-456/{ARCHIVE_BUNDLE_NAME}"
