"""Unit tests for workflow run repository with status filter."""

import uuid
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import sessionmaker

from models import WorkflowRun, WorkflowRunTriggeredFrom
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository


class TestDifyAPISQLAlchemyWorkflowRunRepository:
    """Test workflow run repository with status filtering."""

    @pytest.fixture
    def mock_session_maker(self):
        """Create a mock session maker."""
        return MagicMock(spec=sessionmaker)

    @pytest.fixture
    def repository(self, mock_session_maker):
        """Create repository instance with mock session."""
        return DifyAPISQLAlchemyWorkflowRunRepository(mock_session_maker)

    def test_get_paginated_workflow_runs_without_status(self, repository, mock_session_maker):
        """Test getting paginated workflow runs without status filter."""
        # Arrange
        tenant_id = str(uuid.uuid4())
        app_id = str(uuid.uuid4())
        mock_session = MagicMock()
        mock_session_maker.return_value.__enter__.return_value = mock_session

        mock_runs = [MagicMock(spec=WorkflowRun) for _ in range(3)]
        mock_session.scalars.return_value.all.return_value = mock_runs

        # Act
        result = repository.get_paginated_workflow_runs(
            tenant_id=tenant_id,
            app_id=app_id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            limit=20,
            last_id=None,
            status=None,
        )

        # Assert
        assert len(result.data) == 3
        assert result.limit == 20
        assert result.has_more is False

    def test_get_paginated_workflow_runs_with_status_filter(self, repository, mock_session_maker):
        """Test getting paginated workflow runs with status filter."""
        # Arrange
        tenant_id = str(uuid.uuid4())
        app_id = str(uuid.uuid4())
        mock_session = MagicMock()
        mock_session_maker.return_value.__enter__.return_value = mock_session

        mock_runs = [MagicMock(spec=WorkflowRun, status="succeeded") for _ in range(2)]
        mock_session.scalars.return_value.all.return_value = mock_runs

        # Act
        result = repository.get_paginated_workflow_runs(
            tenant_id=tenant_id,
            app_id=app_id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            limit=20,
            last_id=None,
            status="succeeded",
        )

        # Assert
        assert len(result.data) == 2
        assert all(run.status == "succeeded" for run in result.data)

    def test_get_workflow_runs_count_without_status(self, repository, mock_session_maker):
        """Test getting workflow runs count without status filter."""
        # Arrange
        tenant_id = str(uuid.uuid4())
        app_id = str(uuid.uuid4())
        mock_session = MagicMock()
        mock_session_maker.return_value.__enter__.return_value = mock_session

        # Mock the GROUP BY query results
        mock_results = [
            ("succeeded", 5),
            ("failed", 2),
            ("running", 1),
        ]
        mock_session.execute.return_value.all.return_value = mock_results

        # Act
        result = repository.get_workflow_runs_count(
            tenant_id=tenant_id,
            app_id=app_id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            status=None,
        )

        # Assert
        assert result["total"] == 8
        assert result["succeeded"] == 5
        assert result["failed"] == 2
        assert result["running"] == 1
        assert result["stopped"] == 0
        assert result["partial-succeeded"] == 0

    def test_get_workflow_runs_count_with_status_filter(self, repository, mock_session_maker):
        """Test getting workflow runs count with status filter."""
        # Arrange
        tenant_id = str(uuid.uuid4())
        app_id = str(uuid.uuid4())
        mock_session = MagicMock()
        mock_session_maker.return_value.__enter__.return_value = mock_session

        # Mock the count query for succeeded status
        mock_session.scalar.return_value = 5

        # Act
        result = repository.get_workflow_runs_count(
            tenant_id=tenant_id,
            app_id=app_id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            status="succeeded",
        )

        # Assert
        assert result["total"] == 5
        assert result["succeeded"] == 5
        assert result["running"] == 0
        assert result["failed"] == 0
        assert result["stopped"] == 0
        assert result["partial-succeeded"] == 0

    def test_get_workflow_runs_count_with_invalid_status(self, repository, mock_session_maker):
        """Test that invalid status is still counted in total but not in any specific status."""
        # Arrange
        tenant_id = str(uuid.uuid4())
        app_id = str(uuid.uuid4())
        mock_session = MagicMock()
        mock_session_maker.return_value.__enter__.return_value = mock_session

        # Mock count query returning 0 for invalid status
        mock_session.scalar.return_value = 0

        # Act
        result = repository.get_workflow_runs_count(
            tenant_id=tenant_id,
            app_id=app_id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            status="invalid_status",
        )

        # Assert
        assert result["total"] == 0
        assert all(result[status] == 0 for status in ["running", "succeeded", "failed", "stopped", "partial-succeeded"])

    def test_get_workflow_runs_count_with_time_range(self, repository, mock_session_maker):
        """Test getting workflow runs count with time range filter verifies SQL query construction."""
        # Arrange
        tenant_id = str(uuid.uuid4())
        app_id = str(uuid.uuid4())
        mock_session = MagicMock()
        mock_session_maker.return_value.__enter__.return_value = mock_session

        # Mock the GROUP BY query results
        mock_results = [
            ("succeeded", 3),
            ("running", 2),
        ]
        mock_session.execute.return_value.all.return_value = mock_results

        # Act
        result = repository.get_workflow_runs_count(
            tenant_id=tenant_id,
            app_id=app_id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            status=None,
            time_range="1d",
        )

        # Assert results
        assert result["total"] == 5
        assert result["succeeded"] == 3
        assert result["running"] == 2
        assert result["failed"] == 0

        # Verify that execute was called (which means GROUP BY query was used)
        assert mock_session.execute.called, "execute should have been called for GROUP BY query"

        # Verify SQL query includes time filter by checking the statement
        call_args = mock_session.execute.call_args
        assert call_args is not None, "execute should have been called with a statement"

        # The first argument should be the SQL statement
        stmt = call_args[0][0]
        # Convert to string to inspect the query
        query_str = str(stmt.compile(compile_kwargs={"literal_binds": True}))

        # Verify the query includes created_at filter
        # The query should have a WHERE clause with created_at comparison
        assert "created_at" in query_str.lower() or "workflow_runs.created_at" in query_str.lower(), (
            "Query should include created_at filter for time range"
        )

    def test_get_workflow_runs_count_with_status_and_time_range(self, repository, mock_session_maker):
        """Test getting workflow runs count with both status and time range filters verifies SQL query."""
        # Arrange
        tenant_id = str(uuid.uuid4())
        app_id = str(uuid.uuid4())
        mock_session = MagicMock()
        mock_session_maker.return_value.__enter__.return_value = mock_session

        # Mock the count query for running status within time range
        mock_session.scalar.return_value = 2

        # Act
        result = repository.get_workflow_runs_count(
            tenant_id=tenant_id,
            app_id=app_id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            status="running",
            time_range="1d",
        )

        # Assert results
        assert result["total"] == 2
        assert result["running"] == 2
        assert result["succeeded"] == 0
        assert result["failed"] == 0

        # Verify that scalar was called (which means COUNT query was used)
        assert mock_session.scalar.called, "scalar should have been called for count query"

        # Verify SQL query includes both status and time filter
        call_args = mock_session.scalar.call_args
        assert call_args is not None, "scalar should have been called with a statement"

        # The first argument should be the SQL statement
        stmt = call_args[0][0]
        # Convert to string to inspect the query
        query_str = str(stmt.compile(compile_kwargs={"literal_binds": True}))

        # Verify the query includes both filters
        assert "created_at" in query_str.lower() or "workflow_runs.created_at" in query_str.lower(), (
            "Query should include created_at filter for time range"
        )
        assert "status" in query_str.lower() or "workflow_runs.status" in query_str.lower(), (
            "Query should include status filter"
        )
