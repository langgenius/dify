"""
Unit tests for workflow run archiving functionality.

This module contains tests for:
- Archive service
- Rollback service
"""

from datetime import datetime
from unittest.mock import MagicMock, patch


class TestWorkflowRunArchiver:
    """Tests for the WorkflowRunArchiver class."""

    @patch("services.retention.workflow_run.archive_paid_plan_workflow_run.dify_config")
    @patch("services.retention.workflow_run.archive_paid_plan_workflow_run.get_archive_storage", autospec=True)
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

    def test_get_bundle_manifest_key(self):
        """Test V2 bundle manifest key generation."""
        from services.retention.workflow_run.archive_paid_plan_workflow_run import WorkflowRunArchiver

        archiver = WorkflowRunArchiver(run_shard_index=1, run_shard_total=4)

        mock_run = MagicMock()
        mock_run.tenant_id = "9enant-123"
        mock_run.id = "run-456"
        mock_run.created_at = datetime(2024, 1, 15, 12, 0, 0)

        identity = archiver._build_bundle_identity([mock_run])
        key = archiver._get_manifest_object_key(identity)

        assert key.endswith("/manifest.json")
        assert "workflow-runs/v2/tenant_prefix=9/tenant_id=9enant-123/year=2024/month=01" in key
        assert "/shard=01-of-04/" in key
