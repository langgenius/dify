from unittest.mock import MagicMock, call, patch

import pytest

from libs.archive_storage import ArchiveStorageNotConfiguredError
from models.workflow import WorkflowArchiveLog
from tasks.remove_app_and_related_data_task import (
    _delete_app_workflow_archive_logs,
    _delete_archived_workflow_run_files,
    _delete_draft_variable_offload_data,
    _delete_draft_variables,
    delete_draft_variables_batch,
)


class TestDeleteDraftVariablesBatch:
    def test_delete_draft_variables_batch_invalid_batch_size(self):
        """Test that invalid batch size raises ValueError."""
        app_id = "test-app-id"

        with pytest.raises(ValueError, match="batch_size must be positive"):
            delete_draft_variables_batch(app_id, -1)

        with pytest.raises(ValueError, match="batch_size must be positive"):
            delete_draft_variables_batch(app_id, 0)

    @patch("tasks.remove_app_and_related_data_task.delete_draft_variables_batch")
    def test_delete_draft_variables_calls_batch_function(self, mock_batch_delete):
        """Test that _delete_draft_variables calls the batch function correctly."""
        app_id = "test-app-id"
        expected_return = 42
        mock_batch_delete.return_value = expected_return

        result = _delete_draft_variables(app_id)

        assert result == expected_return
        mock_batch_delete.assert_called_once_with(app_id, batch_size=1000)


class TestDeleteDraftVariableOffloadData:
    """Test the Offload data cleanup functionality."""

    def test_delete_draft_variable_offload_data_empty_file_ids(self):
        """Test handling of empty file_ids list."""
        mock_conn = MagicMock()

        result = _delete_draft_variable_offload_data(mock_conn, [])

        assert result == 0
        mock_conn.execute.assert_not_called()

    @patch("tasks.remove_app_and_related_data_task.logging")
    def test_delete_draft_variable_offload_data_database_failure(self, mock_logging):
        """Test handling of database operation failures."""
        mock_conn = MagicMock()
        file_ids = ["file-1"]

        # Make execute raise an exception
        mock_conn.execute.side_effect = Exception("Database error")

        # Execute function - should not raise, but log error
        result = _delete_draft_variable_offload_data(mock_conn, file_ids)

        # Should return 0 when error occurs
        assert result == 0

        # Verify error was logged
        mock_logging.exception.assert_called_once_with("Error deleting draft variable offload data:")


class TestDeleteWorkflowArchiveLogs:
    @patch("tasks.remove_app_and_related_data_task._delete_records")
    @patch("tasks.remove_app_and_related_data_task.db")
    def test_delete_app_workflow_archive_logs_calls_delete_records(self, mock_db, mock_delete_records):
        tenant_id = "tenant-1"
        app_id = "app-1"

        _delete_app_workflow_archive_logs(tenant_id, app_id)

        mock_delete_records.assert_called_once()
        query_sql, params, delete_func, name = mock_delete_records.call_args[0]
        assert "workflow_archive_logs" in query_sql
        assert params == {"tenant_id": tenant_id, "app_id": app_id}
        assert name == "workflow archive log"

        mock_query = MagicMock()
        mock_delete_query = MagicMock()
        mock_query.where.return_value = mock_delete_query
        mock_db.session.query.return_value = mock_query

        delete_func(mock_db.session, "log-1")

        mock_db.session.query.assert_called_once_with(WorkflowArchiveLog)
        mock_query.where.assert_called_once()
        mock_delete_query.delete.assert_called_once_with(synchronize_session=False)


class TestDeleteArchivedWorkflowRunFiles:
    @patch("tasks.remove_app_and_related_data_task.get_archive_storage")
    @patch("tasks.remove_app_and_related_data_task.logger")
    def test_delete_archived_workflow_run_files_not_configured(self, mock_logger, mock_get_storage):
        mock_get_storage.side_effect = ArchiveStorageNotConfiguredError("missing config")

        _delete_archived_workflow_run_files("tenant-1", "app-1")

        assert mock_logger.info.call_count == 1
        assert "Archive storage not configured" in mock_logger.info.call_args[0][0]

    @patch("tasks.remove_app_and_related_data_task.get_archive_storage")
    @patch("tasks.remove_app_and_related_data_task.logger")
    def test_delete_archived_workflow_run_files_list_failure(self, mock_logger, mock_get_storage):
        storage = MagicMock()
        storage.list_objects.side_effect = Exception("list failed")
        mock_get_storage.return_value = storage

        _delete_archived_workflow_run_files("tenant-1", "app-1")

        storage.list_objects.assert_called_once_with("tenant-1/app_id=app-1/")
        storage.delete_object.assert_not_called()
        mock_logger.exception.assert_called_once_with("Failed to list archive files for app %s", "app-1")

    @patch("tasks.remove_app_and_related_data_task.get_archive_storage")
    @patch("tasks.remove_app_and_related_data_task.logger")
    def test_delete_archived_workflow_run_files_success(self, mock_logger, mock_get_storage):
        storage = MagicMock()
        storage.list_objects.return_value = ["key-1", "key-2"]
        mock_get_storage.return_value = storage

        _delete_archived_workflow_run_files("tenant-1", "app-1")

        storage.list_objects.assert_called_once_with("tenant-1/app_id=app-1/")
        storage.delete_object.assert_has_calls([call("key-1"), call("key-2")], any_order=False)
        mock_logger.info.assert_called_with("Deleted %s archive objects for app %s", 2, "app-1")
