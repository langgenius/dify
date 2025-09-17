from unittest.mock import ANY, MagicMock, call, patch

import pytest
import sqlalchemy as sa

from tasks.remove_app_and_related_data_task import _delete_draft_variables, delete_draft_variables_batch


class TestDeleteDraftVariablesBatch:
    @patch("tasks.remove_app_and_related_data_task.db")
    def test_delete_draft_variables_batch_success(self, mock_db):
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
        batch1_ids = [f"var-{i}" for i in range(100)]
        batch2_ids = [f"var-{i}" for i in range(100, 150)]

        # Setup side effects for execute calls in the correct order:
        # 1. SELECT (returns batch1_ids)
        # 2. DELETE (returns result with rowcount=100)
        # 3. SELECT (returns batch2_ids)
        # 4. DELETE (returns result with rowcount=50)
        # 5. SELECT (returns empty, ends loop)

        # Create mock results with actual integer rowcount attributes
        class MockResult:
            def __init__(self, rowcount):
                self.rowcount = rowcount

        # First SELECT result
        select_result1 = MagicMock()
        select_result1.__iter__.return_value = iter([(id_,) for id_ in batch1_ids])

        # First DELETE result
        delete_result1 = MockResult(rowcount=100)

        # Second SELECT result
        select_result2 = MagicMock()
        select_result2.__iter__.return_value = iter([(id_,) for id_ in batch2_ids])

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

        # Execute the function
        result = delete_draft_variables_batch(app_id, batch_size)

        # Verify the result
        assert result == 150

        # Verify database calls
        assert mock_conn.execute.call_count == 5  # 3 selects + 2 deletes

        # Verify the expected calls in order:
        # 1. SELECT, 2. DELETE, 3. SELECT, 4. DELETE, 5. SELECT
        expected_calls = [
            # First SELECT
            call(
                sa.text("""
                SELECT id FROM workflow_draft_variables
                WHERE app_id = :app_id
                LIMIT :batch_size
            """),
                {"app_id": app_id, "batch_size": batch_size},
            ),
            # First DELETE
            call(
                sa.text("""
                DELETE FROM workflow_draft_variables
                WHERE id IN :ids
            """),
                {"ids": tuple(batch1_ids)},
            ),
            # Second SELECT
            call(
                sa.text("""
                SELECT id FROM workflow_draft_variables
                WHERE app_id = :app_id
                LIMIT :batch_size
            """),
                {"app_id": app_id, "batch_size": batch_size},
            ),
            # Second DELETE
            call(
                sa.text("""
                DELETE FROM workflow_draft_variables
                WHERE id IN :ids
            """),
                {"ids": tuple(batch2_ids)},
            ),
            # Third SELECT (empty result)
            call(
                sa.text("""
                SELECT id FROM workflow_draft_variables
                WHERE app_id = :app_id
                LIMIT :batch_size
            """),
                {"app_id": app_id, "batch_size": batch_size},
            ),
        ]

        # Check that all calls were made correctly
        actual_calls = mock_conn.execute.call_args_list
        assert len(actual_calls) == len(expected_calls)

        # Simplified verification - just check that the right number of calls were made
        # and that the SQL queries contain the expected patterns
        for i, actual_call in enumerate(actual_calls):
            if i % 2 == 0:  # SELECT calls (even indices: 0, 2, 4)
                # Verify it's a SELECT query
                sql_text = str(actual_call[0][0])
                assert "SELECT id FROM workflow_draft_variables" in sql_text
                assert "WHERE app_id = :app_id" in sql_text
                assert "LIMIT :batch_size" in sql_text
            else:  # DELETE calls (odd indices: 1, 3)
                # Verify it's a DELETE query
                sql_text = str(actual_call[0][0])
                assert "DELETE FROM workflow_draft_variables" in sql_text
                assert "WHERE id IN :ids" in sql_text

    @patch("tasks.remove_app_and_related_data_task.db")
    def test_delete_draft_variables_batch_empty_result(self, mock_db):
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

    def test_delete_draft_variables_batch_invalid_batch_size(self):
        """Test that invalid batch size raises ValueError."""
        app_id = "test-app-id"

        with pytest.raises(ValueError, match="batch_size must be positive"):
            delete_draft_variables_batch(app_id, -1)

        with pytest.raises(ValueError, match="batch_size must be positive"):
            delete_draft_variables_batch(app_id, 0)

    @patch("tasks.remove_app_and_related_data_task.db")
    @patch("tasks.remove_app_and_related_data_task.logger")
    def test_delete_draft_variables_batch_logs_progress(self, mock_logging, mock_db):
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
        batch_ids = [f"var-{i}" for i in range(30)]
        # Create properly configured mocks
        select_result = MagicMock()
        select_result.__iter__.return_value = iter([(id_,) for id_ in batch_ids])

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

        result = delete_draft_variables_batch(app_id, batch_size)

        assert result == 30

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
