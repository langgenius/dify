from datetime import datetime
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from models.workflow import WorkflowNodeExecutionModel
from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)


class TestSQLAlchemyWorkflowNodeExecutionServiceRepository:
    @pytest.fixture
    def repository(self):
        mock_session_maker = MagicMock()
        return DifyAPISQLAlchemyWorkflowNodeExecutionRepository(session_maker=mock_session_maker)

    @pytest.fixture
    def mock_execution(self):
        execution = MagicMock(spec=WorkflowNodeExecutionModel)
        execution.id = str(uuid4())
        execution.tenant_id = "tenant-123"
        execution.app_id = "app-456"
        execution.workflow_id = "workflow-789"
        execution.workflow_run_id = "run-101"
        execution.node_id = "node-202"
        execution.index = 1
        execution.created_at = "2023-01-01T00:00:00Z"
        return execution

    def test_get_node_last_execution_found(self, repository, mock_execution):
        """Test getting the last execution for a node when it exists."""
        # Arrange
        mock_session = MagicMock(spec=Session)
        repository._session_maker.return_value.__enter__.return_value = mock_session
        mock_session.scalar.return_value = mock_execution

        # Act
        result = repository.get_node_last_execution(
            tenant_id="tenant-123",
            app_id="app-456",
            workflow_id="workflow-789",
            node_id="node-202",
        )

        # Assert
        assert result == mock_execution
        mock_session.scalar.assert_called_once()
        # Verify the query was constructed correctly
        call_args = mock_session.scalar.call_args[0][0]
        assert hasattr(call_args, "compile")  # It's a SQLAlchemy statement

    def test_get_node_last_execution_not_found(self, repository):
        """Test getting the last execution for a node when it doesn't exist."""
        # Arrange
        mock_session = MagicMock(spec=Session)
        repository._session_maker.return_value.__enter__.return_value = mock_session
        mock_session.scalar.return_value = None

        # Act
        result = repository.get_node_last_execution(
            tenant_id="tenant-123",
            app_id="app-456",
            workflow_id="workflow-789",
            node_id="node-202",
        )

        # Assert
        assert result is None
        mock_session.scalar.assert_called_once()

    def test_get_executions_by_workflow_run(self, repository, mock_execution):
        """Test getting all executions for a workflow run."""
        # Arrange
        mock_session = MagicMock(spec=Session)
        repository._session_maker.return_value.__enter__.return_value = mock_session
        executions = [mock_execution]
        mock_session.execute.return_value.scalars.return_value.all.return_value = executions

        # Act
        result = repository.get_executions_by_workflow_run(
            tenant_id="tenant-123",
            app_id="app-456",
            workflow_run_id="run-101",
        )

        # Assert
        assert result == executions
        mock_session.execute.assert_called_once()
        # Verify the query was constructed correctly
        call_args = mock_session.execute.call_args[0][0]
        assert hasattr(call_args, "compile")  # It's a SQLAlchemy statement

    def test_get_executions_by_workflow_run_empty(self, repository):
        """Test getting executions for a workflow run when none exist."""
        # Arrange
        mock_session = MagicMock(spec=Session)
        repository._session_maker.return_value.__enter__.return_value = mock_session
        mock_session.execute.return_value.scalars.return_value.all.return_value = []

        # Act
        result = repository.get_executions_by_workflow_run(
            tenant_id="tenant-123",
            app_id="app-456",
            workflow_run_id="run-101",
        )

        # Assert
        assert result == []
        mock_session.execute.assert_called_once()

    def test_get_execution_by_id_found(self, repository, mock_execution):
        """Test getting execution by ID when it exists."""
        # Arrange
        mock_session = MagicMock(spec=Session)
        repository._session_maker.return_value.__enter__.return_value = mock_session
        mock_session.scalar.return_value = mock_execution

        # Act
        result = repository.get_execution_by_id(mock_execution.id)

        # Assert
        assert result == mock_execution
        mock_session.scalar.assert_called_once()

    def test_get_execution_by_id_not_found(self, repository):
        """Test getting execution by ID when it doesn't exist."""
        # Arrange
        mock_session = MagicMock(spec=Session)
        repository._session_maker.return_value.__enter__.return_value = mock_session
        mock_session.scalar.return_value = None

        # Act
        result = repository.get_execution_by_id("non-existent-id")

        # Assert
        assert result is None
        mock_session.scalar.assert_called_once()

    def test_repository_implements_protocol(self, repository):
        """Test that the repository implements the required protocol methods."""
        # Verify all protocol methods are implemented
        assert hasattr(repository, "get_node_last_execution")
        assert hasattr(repository, "get_executions_by_workflow_run")
        assert hasattr(repository, "get_execution_by_id")

        # Verify methods are callable
        assert callable(repository.get_node_last_execution)
        assert callable(repository.get_executions_by_workflow_run)
        assert callable(repository.get_execution_by_id)
        assert callable(repository.delete_expired_executions)
        assert callable(repository.delete_executions_by_app)
        assert callable(repository.get_expired_executions_batch)
        assert callable(repository.delete_executions_by_ids)

    def test_delete_expired_executions(self, repository):
        """Test deleting expired executions."""
        # Arrange
        mock_session = MagicMock(spec=Session)
        repository._session_maker.return_value.__enter__.return_value = mock_session

        # Mock the select query to return some IDs first time, then empty to stop loop
        execution_ids = ["id1", "id2"]  # Less than batch_size to trigger break

        # Mock execute method to handle both select and delete statements
        def mock_execute(stmt):
            mock_result = MagicMock()
            # For select statements, return execution IDs
            if hasattr(stmt, "limit"):  # This is our select statement
                mock_result.scalars.return_value.all.return_value = execution_ids
            else:  # This is our delete statement
                mock_result.rowcount = 2
            return mock_result

        mock_session.execute.side_effect = mock_execute

        before_date = datetime(2023, 1, 1)

        # Act
        result = repository.delete_expired_executions(
            tenant_id="tenant-123",
            before_date=before_date,
            batch_size=1000,
        )

        # Assert
        assert result == 2
        assert mock_session.execute.call_count == 2  # One select call, one delete call
        mock_session.commit.assert_called_once()

    def test_delete_executions_by_app(self, repository):
        """Test deleting executions by app."""
        # Arrange
        mock_session = MagicMock(spec=Session)
        repository._session_maker.return_value.__enter__.return_value = mock_session

        # Mock the select query to return some IDs first time, then empty to stop loop
        execution_ids = ["id1", "id2"]

        # Mock execute method to handle both select and delete statements
        def mock_execute(stmt):
            mock_result = MagicMock()
            # For select statements, return execution IDs
            if hasattr(stmt, "limit"):  # This is our select statement
                mock_result.scalars.return_value.all.return_value = execution_ids
            else:  # This is our delete statement
                mock_result.rowcount = 2
            return mock_result

        mock_session.execute.side_effect = mock_execute

        # Act
        result = repository.delete_executions_by_app(
            tenant_id="tenant-123",
            app_id="app-456",
            batch_size=1000,
        )

        # Assert
        assert result == 2
        assert mock_session.execute.call_count == 2  # One select call, one delete call
        mock_session.commit.assert_called_once()

    def test_get_expired_executions_batch(self, repository):
        """Test getting expired executions batch for backup."""
        # Arrange
        mock_session = MagicMock(spec=Session)
        repository._session_maker.return_value.__enter__.return_value = mock_session

        # Create mock execution objects
        mock_execution1 = MagicMock()
        mock_execution1.id = "exec-1"
        mock_execution2 = MagicMock()
        mock_execution2.id = "exec-2"

        mock_session.execute.return_value.scalars.return_value.all.return_value = [mock_execution1, mock_execution2]

        before_date = datetime(2023, 1, 1)

        # Act
        result = repository.get_expired_executions_batch(
            tenant_id="tenant-123",
            before_date=before_date,
            batch_size=1000,
        )

        # Assert
        assert len(result) == 2
        assert result[0].id == "exec-1"
        assert result[1].id == "exec-2"
        mock_session.execute.assert_called_once()

    def test_delete_executions_by_ids(self, repository):
        """Test deleting executions by IDs."""
        # Arrange
        mock_session = MagicMock(spec=Session)
        repository._session_maker.return_value.__enter__.return_value = mock_session

        # Mock the delete query result
        mock_result = MagicMock()
        mock_result.rowcount = 3
        mock_session.execute.return_value = mock_result

        execution_ids = ["id1", "id2", "id3"]

        # Act
        result = repository.delete_executions_by_ids(execution_ids)

        # Assert
        assert result == 3
        mock_session.execute.assert_called_once()
        mock_session.commit.assert_called_once()

    def test_delete_executions_by_ids_empty_list(self, repository):
        """Test deleting executions with empty ID list."""
        # Arrange
        mock_session = MagicMock(spec=Session)
        repository._session_maker.return_value.__enter__.return_value = mock_session

        # Act
        result = repository.delete_executions_by_ids([])

        # Assert
        assert result == 0
        mock_session.query.assert_not_called()
        mock_session.commit.assert_not_called()
