from unittest.mock import ANY, MagicMock, call, patch

import pytest

from tasks.remove_app_and_related_data_task import (
    _delete_draft_variable_offload_data,
    _delete_draft_variables,
    delete_draft_variables_batch,
)


class TestDeleteDraftVariablesBatch:
    @patch("tasks.remove_app_and_related_data_task._delete_draft_variable_offload_data")
    @patch("tasks.remove_app_and_related_data_task.db")
    def test_delete_draft_variables_batch_success(self, mock_db, mock_offload_cleanup):
        """Test successful deletion of draft variables in batches."""
        app_id = "test-app-id"
        batch_size = 100

        # Mock database connection and engine
        mock_conn = MagicMock()
        mock_engine = MagicMock()
        mock_db.engine = mock_engine
        # Properly mock the context manager
        mock_context_manager = MagicMock()
        mock_context_manager.__enter__.return_value = mock_conn
        mock_context_manager.__exit__.return_value = None
        mock_engine.begin.return_value = mock_context_manager

        # Mock two batches of results, then empty
        batch1_data = [(f"var-{i}", f"file-{i}" if i % 2 == 0 else None) for i in range(100)]
        batch2_data = [(f"var-{i}", f"file-{i}" if i % 3 == 0 else None) for i in range(100, 150)]

        batch1_ids = [row[0] for row in batch1_data]
        batch1_file_ids = [row[1] for row in batch1_data if row[1] is not None]

        batch2_ids = [row[0] for row in batch2_data]
        batch2_file_ids = [row[1] for row in batch2_data if row[1] is not None]

        # Setup side effects for execute calls in the correct order:
        # 1. SELECT (returns batch1_data with id, file_id)
        # 2. DELETE (returns result with rowcount=100)
        # 3. SELECT (returns batch2_data)
        # 4. DELETE (returns result with rowcount=50)
        # 5. SELECT (returns empty, ends loop)

        # Create mock results with actual integer rowcount attributes
        class MockResult:
            def __init__(self, rowcount):
                self.rowcount = rowcount

        # First SELECT result
        select_result1 = MagicMock()
        select_result1.__iter__.return_value = iter(batch1_data)

        # First DELETE result
        delete_result1 = MockResult(rowcount=100)

        # Second SELECT result
        select_result2 = MagicMock()
        select_result2.__iter__.return_value = iter(batch2_data)

        # Second DELETE result
        delete_result2 = MockResult(rowcount=50)

        # Third SELECT result (empty, ends loop)
        select_result3 = MagicMock()
        select_result3.__iter__.return_value = iter([])

        # Configure side effects in the correct order
        mock_conn.execute.side_effect = [
            select_result1,  # First SELECT
            delete_result1,  # First DELETE
            select_result2,  # Second SELECT
            delete_result2,  # Second DELETE
            select_result3,  # Third SELECT (empty)
        ]

        # Mock offload data cleanup
        mock_offload_cleanup.side_effect = [len(batch1_file_ids), len(batch2_file_ids)]

        # Execute the function
        result = delete_draft_variables_batch(app_id, batch_size)

        # Verify the result
        assert result == 150

        # Verify database calls
        assert mock_conn.execute.call_count == 5  # 3 selects + 2 deletes

        # Verify offload cleanup was called for both batches with file_ids
        expected_offload_calls = [call(mock_conn, batch1_file_ids), call(mock_conn, batch2_file_ids)]
        mock_offload_cleanup.assert_has_calls(expected_offload_calls)

        # Simplified verification - check that the right number of calls were made
        # and that the SQL queries contain the expected patterns
        actual_calls = mock_conn.execute.call_args_list
        for i, actual_call in enumerate(actual_calls):
            if i % 2 == 0:  # SELECT calls (even indices: 0, 2, 4)
                # Verify it's a SELECT query that now includes file_id
                sql_text = str(actual_call[0][0])
                assert "SELECT id, file_id FROM workflow_draft_variables" in sql_text
                assert "WHERE app_id = :app_id" in sql_text
                assert "LIMIT :batch_size" in sql_text
            else:  # DELETE calls (odd indices: 1, 3)
                # Verify it's a DELETE query
                sql_text = str(actual_call[0][0])
                assert "DELETE FROM workflow_draft_variables" in sql_text
                assert "WHERE id IN :ids" in sql_text

    @patch("tasks.remove_app_and_related_data_task._delete_draft_variable_offload_data")
    @patch("tasks.remove_app_and_related_data_task.db")
    def test_delete_draft_variables_batch_empty_result(self, mock_db, mock_offload_cleanup):
        """Test deletion when no draft variables exist for the app."""
        app_id = "nonexistent-app-id"
        batch_size = 1000

        # Mock database connection
        mock_conn = MagicMock()
        mock_engine = MagicMock()
        mock_db.engine = mock_engine
        # Properly mock the context manager
        mock_context_manager = MagicMock()
        mock_context_manager.__enter__.return_value = mock_conn
        mock_context_manager.__exit__.return_value = None
        mock_engine.begin.return_value = mock_context_manager

        # Mock empty result
        empty_result = MagicMock()
        empty_result.__iter__.return_value = iter([])
        mock_conn.execute.return_value = empty_result

        result = delete_draft_variables_batch(app_id, batch_size)

        assert result == 0
        assert mock_conn.execute.call_count == 1  # Only one select query
        mock_offload_cleanup.assert_not_called()  # No files to clean up

    def test_delete_draft_variables_batch_invalid_batch_size(self):
        """Test that invalid batch size raises ValueError."""
        app_id = "test-app-id"

        with pytest.raises(ValueError, match="batch_size must be positive"):
            delete_draft_variables_batch(app_id, -1)

        with pytest.raises(ValueError, match="batch_size must be positive"):
            delete_draft_variables_batch(app_id, 0)

    @patch("tasks.remove_app_and_related_data_task._delete_draft_variable_offload_data")
    @patch("tasks.remove_app_and_related_data_task.db")
    @patch("tasks.remove_app_and_related_data_task.logger")
    def test_delete_draft_variables_batch_logs_progress(self, mock_logging, mock_db, mock_offload_cleanup):
        """Test that batch deletion logs progress correctly."""
        app_id = "test-app-id"
        batch_size = 50

        # Mock database
        mock_conn = MagicMock()
        mock_engine = MagicMock()
        mock_db.engine = mock_engine
        # Properly mock the context manager
        mock_context_manager = MagicMock()
        mock_context_manager.__enter__.return_value = mock_conn
        mock_context_manager.__exit__.return_value = None
        mock_engine.begin.return_value = mock_context_manager

        # Mock one batch then empty
        batch_data = [(f"var-{i}", f"file-{i}" if i % 3 == 0 else None) for i in range(30)]
        batch_ids = [row[0] for row in batch_data]
        batch_file_ids = [row[1] for row in batch_data if row[1] is not None]

        # Create properly configured mocks
        select_result = MagicMock()
        select_result.__iter__.return_value = iter(batch_data)

        # Create simple object with rowcount attribute
        class MockResult:
            def __init__(self, rowcount):
                self.rowcount = rowcount

        delete_result = MockResult(rowcount=30)

        empty_result = MagicMock()
        empty_result.__iter__.return_value = iter([])

        mock_conn.execute.side_effect = [
            # Select query result
            select_result,
            # Delete query result
            delete_result,
            # Empty select result (end condition)
            empty_result,
        ]

        # Mock offload cleanup
        mock_offload_cleanup.return_value = len(batch_file_ids)

        result = delete_draft_variables_batch(app_id, batch_size)

        assert result == 30

        # Verify offload cleanup was called with file_ids
        if batch_file_ids:
            mock_offload_cleanup.assert_called_once_with(mock_conn, batch_file_ids)

        # Verify logging calls
        assert mock_logging.info.call_count == 2
        mock_logging.info.assert_any_call(
            ANY  # click.style call
        )

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

    @patch("extensions.ext_storage.storage")
    def test_delete_draft_variable_offload_data_success(self, mock_storage):
        """Test successful deletion of offload data."""

        # Mock connection
        mock_conn = MagicMock()
        file_ids = ["file-1", "file-2", "file-3"]

        # Mock query results: (variable_file_id, storage_key, upload_file_id)
        query_results = [
            ("file-1", "storage/key/1", "upload-1"),
            ("file-2", "storage/key/2", "upload-2"),
            ("file-3", "storage/key/3", "upload-3"),
        ]

        mock_result = MagicMock()
        mock_result.__iter__.return_value = iter(query_results)
        mock_conn.execute.return_value = mock_result

        # Execute function
        result = _delete_draft_variable_offload_data(mock_conn, file_ids)

        # Verify return value
        assert result == 3

        # Verify storage deletion calls
        expected_storage_calls = [call("storage/key/1"), call("storage/key/2"), call("storage/key/3")]
        mock_storage.delete.assert_has_calls(expected_storage_calls, any_order=True)

        # Verify database calls - should be 3 calls total
        assert mock_conn.execute.call_count == 3

        # Verify the queries were called
        actual_calls = mock_conn.execute.call_args_list

        # First call should be the SELECT query
        select_call_sql = str(actual_calls[0][0][0])
        assert "SELECT wdvf.id, uf.key, uf.id as upload_file_id" in select_call_sql
        assert "FROM workflow_draft_variable_files wdvf" in select_call_sql
        assert "JOIN upload_files uf ON wdvf.upload_file_id = uf.id" in select_call_sql
        assert "WHERE wdvf.id IN :file_ids" in select_call_sql

        # Second call should be DELETE upload_files
        delete_upload_call_sql = str(actual_calls[1][0][0])
        assert "DELETE FROM upload_files" in delete_upload_call_sql
        assert "WHERE id IN :upload_file_ids" in delete_upload_call_sql

        # Third call should be DELETE workflow_draft_variable_files
        delete_variable_files_call_sql = str(actual_calls[2][0][0])
        assert "DELETE FROM workflow_draft_variable_files" in delete_variable_files_call_sql
        assert "WHERE id IN :file_ids" in delete_variable_files_call_sql

    def test_delete_draft_variable_offload_data_empty_file_ids(self):
        """Test handling of empty file_ids list."""
        mock_conn = MagicMock()

        result = _delete_draft_variable_offload_data(mock_conn, [])

        assert result == 0
        mock_conn.execute.assert_not_called()

    @patch("extensions.ext_storage.storage")
    @patch("tasks.remove_app_and_related_data_task.logging")
    def test_delete_draft_variable_offload_data_storage_failure(self, mock_logging, mock_storage):
        """Test handling of storage deletion failures."""
        mock_conn = MagicMock()
        file_ids = ["file-1", "file-2"]

        # Mock query results
        query_results = [
            ("file-1", "storage/key/1", "upload-1"),
            ("file-2", "storage/key/2", "upload-2"),
        ]

        mock_result = MagicMock()
        mock_result.__iter__.return_value = iter(query_results)
        mock_conn.execute.return_value = mock_result

        # Make storage.delete fail for the first file
        mock_storage.delete.side_effect = [Exception("Storage error"), None]

        # Execute function
        result = _delete_draft_variable_offload_data(mock_conn, file_ids)

        # Should still return 2 (both files processed, even if one storage delete failed)
        assert result == 1  # Only one storage deletion succeeded

        # Verify warning was logged
        mock_logging.exception.assert_called_once_with("Failed to delete storage object %s", "storage/key/1")

        # Verify both database cleanup calls still happened
        assert mock_conn.execute.call_count == 3

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
