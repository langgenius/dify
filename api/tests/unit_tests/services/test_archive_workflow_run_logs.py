"""
Unit tests for workflow run archiving functionality.

This module contains tests for:
- Archive service
- Rollback service
- Export service
"""

from datetime import datetime
from unittest.mock import MagicMock, patch


class TestWorkflowRunArchiver:
    """Tests for the WorkflowRunArchiver class."""

    @patch("services.retention.archive_paid_plan_workflow_run.dify_config")
    @patch("services.retention.archive_paid_plan_workflow_run.get_archive_storage")
    def test_archiver_initialization(self, mock_get_storage, mock_config):
        """Test archiver can be initialized with various options."""
        from services.retention.archive_paid_plan_workflow_run import WorkflowRunArchiver

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
        assert archiver.tenant_ids == {"test-tenant"}
        assert archiver.limit == 50
        assert archiver.dry_run is True

    def test_model_to_dict(self):
        """Test SQLAlchemy model to dict conversion."""
        from services.retention.archive_paid_plan_workflow_run import WorkflowRunArchiver

        # Create a mock model with __table__.columns
        mock_model = MagicMock()
        mock_column = MagicMock()
        mock_column.name = "id"
        mock_column.key = "id"
        mock_model.__table__ = MagicMock()
        mock_model.__table__.columns = [mock_column]
        mock_model.id = "test-id"

        archiver = WorkflowRunArchiver.__new__(WorkflowRunArchiver)
        result = archiver._model_to_dict(mock_model)

        assert result["id"] == "test-id"

    def test_get_manifest_key(self):
        """Test manifest key generation."""
        from services.retention.archive_paid_plan_workflow_run import WorkflowRunArchiver

        archiver = WorkflowRunArchiver.__new__(WorkflowRunArchiver)

        mock_run = MagicMock()
        mock_run.tenant_id = "tenant-123"
        mock_run.app_id = "app-999"
        mock_run.id = "run-456"
        mock_run.created_at = datetime(2024, 1, 15, 12, 0, 0)

        key = archiver._get_manifest_key(mock_run)

        assert key == "tenant-123/app_id=app-999/year=2024/month=01/workflow_run_id=run-456/manifest.json"

    def test_get_table_key(self):
        """Test table data key generation."""
        from services.retention.archive_paid_plan_workflow_run import WorkflowRunArchiver

        archiver = WorkflowRunArchiver.__new__(WorkflowRunArchiver)

        mock_run = MagicMock()
        mock_run.tenant_id = "tenant-123"
        mock_run.app_id = "app-999"
        mock_run.id = "run-456"
        mock_run.created_at = datetime(2024, 1, 15, 12, 0, 0)

        key = archiver._get_table_key(mock_run, "workflow_node_executions")

        assert (
            key == "tenant-123/app_id=app-999/year=2024/month=01/workflow_run_id=run-456/"
            "table=workflow_node_executions/data.jsonl.gz"
        )


class TestWorkflowRunExportService:
    """Tests for the WorkflowRunExportService class."""

    def test_export_service_initialization(self):
        """Test export service can be instantiated."""
        from services.retention.export_workflow_run import WorkflowRunExportService

        service = WorkflowRunExportService()

        assert service is not None
        assert len(service.EXPORTED_TABLES) == 5
