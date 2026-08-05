import logging
from datetime import UTC, datetime
from unittest.mock import MagicMock, call, patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from graphon.enums import WorkflowExecutionStatus
from libs.archive_storage import ArchiveStorageNotConfiguredError
from models import AppStar
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowArchiveLog
from tasks.remove_app_and_related_data_task import (
    _delete_app_stars,
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

    def test_delete_draft_variable_offload_data_database_failure(self, caplog: pytest.LogCaptureFixture):
        """Test handling of database operation failures."""
        mock_conn = MagicMock()
        file_ids = ["file-1"]
        mock_conn.execute.side_effect = Exception("Database error")

        with caplog.at_level(logging.ERROR):
            result = _delete_draft_variable_offload_data(mock_conn, file_ids)

        assert result == 0
        assert "Error deleting draft variable offload data:" in caplog.text


class TestDeleteWorkflowArchiveLogs:
    @pytest.mark.parametrize("sqlite_session", [(WorkflowArchiveLog,)], indirect=True)
    @patch("tasks.remove_app_and_related_data_task._delete_records")
    @patch("tasks.remove_app_and_related_data_task.db")
    def test_delete_app_workflow_archive_logs_calls_delete_records(
        self, mock_db, mock_delete_records, sqlite_session: Session
    ):
        tenant_id = "tenant-1"
        app_id = "app-1"

        _delete_app_workflow_archive_logs(tenant_id, app_id)

        mock_delete_records.assert_called_once()
        query_sql, params, delete_func, name = mock_delete_records.call_args[0]
        assert "workflow_archive_logs" in query_sql
        assert params == {"tenant_id": tenant_id, "app_id": app_id}
        assert name == "workflow archive log"

        archive_log = WorkflowArchiveLog(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            workflow_run_id=str(uuid4()),
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=str(uuid4()),
            log_id=None,
            log_created_at=None,
            log_created_from=None,
            run_version="1",
            run_status=WorkflowExecutionStatus.SUCCEEDED,
            run_triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            run_error=None,
            run_elapsed_time=0,
            run_total_tokens=0,
            run_total_steps=1,
            run_created_at=datetime.now(UTC),
            run_finished_at=datetime.now(UTC),
            run_exceptions_count=0,
            trigger_metadata=None,
        )
        sqlite_session.add(archive_log)
        sqlite_session.commit()

        delete_func(sqlite_session, archive_log.id)
        sqlite_session.commit()
        sqlite_session.expunge_all()

        assert sqlite_session.get(WorkflowArchiveLog, archive_log.id) is None


class TestDeleteAppStars:
    @pytest.mark.parametrize("sqlite_session", [(AppStar,)], indirect=True)
    @patch("tasks.remove_app_and_related_data_task._delete_records")
    def test_delete_app_stars_calls_delete_records(self, mock_delete_records, sqlite_session: Session):
        tenant_id = "tenant-1"
        app_id = "app-1"

        _delete_app_stars(tenant_id, app_id)

        mock_delete_records.assert_called_once()
        query_sql, params, delete_func, name = mock_delete_records.call_args[0]
        assert "app_stars" in query_sql
        assert params == {"tenant_id": tenant_id, "app_id": app_id}
        assert name == "app star"

        app_star = AppStar(tenant_id=str(uuid4()), app_id=str(uuid4()), account_id=str(uuid4()))
        sqlite_session.add(app_star)
        sqlite_session.commit()

        delete_func(sqlite_session, app_star.id)
        sqlite_session.commit()
        sqlite_session.expunge_all()

        assert sqlite_session.get(AppStar, app_star.id) is None


class TestDeleteArchivedWorkflowRunFiles:
    @patch("tasks.remove_app_and_related_data_task.get_archive_storage")
    def test_delete_archived_workflow_run_files_not_configured(
        self, mock_get_storage, caplog: pytest.LogCaptureFixture
    ):
        mock_get_storage.side_effect = ArchiveStorageNotConfiguredError("missing config")

        with caplog.at_level(logging.INFO, logger="tasks.remove_app_and_related_data_task"):
            _delete_archived_workflow_run_files("tenant-1", "app-1")

        assert caplog.text.count("Archive storage not configured") == 1

    @patch("tasks.remove_app_and_related_data_task.get_archive_storage")
    def test_delete_archived_workflow_run_files_list_failure(self, mock_get_storage, caplog: pytest.LogCaptureFixture):
        storage = MagicMock()
        storage.list_objects.side_effect = Exception("list failed")
        mock_get_storage.return_value = storage

        with caplog.at_level(logging.ERROR, logger="tasks.remove_app_and_related_data_task"):
            _delete_archived_workflow_run_files("tenant-1", "app-1")

        storage.list_objects.assert_called_once_with("tenant-1/app_id=app-1/")
        storage.delete_object.assert_not_called()
        assert "Failed to list archive files for app app-1" in caplog.text

    @patch("tasks.remove_app_and_related_data_task.get_archive_storage")
    def test_delete_archived_workflow_run_files_success(self, mock_get_storage, caplog: pytest.LogCaptureFixture):
        storage = MagicMock()
        storage.list_objects.return_value = ["key-1", "key-2"]
        mock_get_storage.return_value = storage

        with caplog.at_level(logging.INFO, logger="tasks.remove_app_and_related_data_task"):
            _delete_archived_workflow_run_files("tenant-1", "app-1")

        storage.list_objects.assert_called_once_with("tenant-1/app_id=app-1/")
        storage.delete_object.assert_has_calls([call("key-1"), call("key-2")], any_order=False)
        assert "Deleted 2 archive objects for app app-1" in caplog.text
