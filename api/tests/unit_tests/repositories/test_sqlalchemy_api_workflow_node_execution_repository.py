"""Unit tests for DifyAPISQLAlchemyWorkflowNodeExecutionRepository filtering and node lookup."""

from datetime import datetime
from unittest.mock import Mock, patch

import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.workflow import WorkflowNodeExecutionModel
from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)


class TestDifyAPISQLAlchemyWorkflowNodeExecutionRepositoryFiltering:
    """Test filtering functionality in DifyAPISQLAlchemyWorkflowNodeExecutionRepository."""

    @pytest.fixture
    def mock_session(self):
        """Create a mock session."""
        return Mock(spec=Session)

    @pytest.fixture
    def mock_session_maker(self, mock_session):
        """Create a mock sessionmaker."""
        session_maker = Mock(spec=sessionmaker)

        context_manager = Mock()
        context_manager.__enter__ = Mock(return_value=mock_session)
        context_manager.__exit__ = Mock(return_value=None)
        session_maker.return_value = context_manager

        mock_session.scalar = Mock()
        mock_session.execute = Mock()
        mock_session.scalars = Mock()

        return session_maker

    @pytest.fixture
    def repository(self, mock_session_maker):
        """Create repository instance with mocked dependencies."""
        return DifyAPISQLAlchemyWorkflowNodeExecutionRepository(mock_session_maker)

    @pytest.fixture
    def sample_node_execution(self):
        """Create a sample WorkflowNodeExecutionModel."""
        execution = Mock(spec=WorkflowNodeExecutionModel)
        execution.id = "execution-123"
        execution.tenant_id = "tenant-123"
        execution.app_id = "app-123"
        execution.workflow_run_id = "run-123"
        execution.node_id = "node-123"
        execution.node_type = "http-request"
        execution.status = "succeeded"
        execution.created_at = datetime.now()
        return execution

    def test_get_executions_by_workflow_run_no_filters(self, repository, mock_session, mock_session_maker):
        """Test getting executions without filters."""
        # Arrange
        mock_result = Mock()
        mock_result.scalars.return_value.all.return_value = []
        mock_session.execute.return_value = mock_result

        # Act
        result = repository.get_executions_by_workflow_run(
            tenant_id="tenant-123",
            app_id="app-123",
            workflow_run_id="run-123",
        )

        # Assert
        assert result == []
        mock_session_maker.assert_called_once()
        mock_session.execute.assert_called_once()

    def test_get_executions_by_workflow_run_with_node_id_filter(
        self, repository, mock_session, mock_session_maker, sample_node_execution
    ):
        """Test getting executions filtered by node_id."""
        # Arrange
        mock_result = Mock()
        mock_result.scalars.return_value.all.return_value = [sample_node_execution]
        mock_session.execute.return_value = mock_result

        # Act
        result = repository.get_executions_by_workflow_run(
            tenant_id="tenant-123",
            app_id="app-123",
            workflow_run_id="run-123",
            node_id="node-123",
        )

        # Assert
        assert len(result) == 1
        assert result[0] == sample_node_execution
        mock_session.execute.assert_called_once()

    def test_get_executions_by_workflow_run_with_node_type_filter(
        self, repository, mock_session, mock_session_maker, sample_node_execution
    ):
        """Test getting executions filtered by node_type."""
        # Arrange
        mock_result = Mock()
        mock_result.scalars.return_value.all.return_value = [sample_node_execution]
        mock_session.execute.return_value = mock_result

        # Act
        result = repository.get_executions_by_workflow_run(
            tenant_id="tenant-123",
            app_id="app-123",
            workflow_run_id="run-123",
            node_type="http-request",
        )

        # Assert
        assert len(result) == 1
        assert result[0] == sample_node_execution
        mock_session.execute.assert_called_once()

    def test_get_executions_by_workflow_run_with_status_filter(
        self, repository, mock_session, mock_session_maker, sample_node_execution
    ):
        """Test getting executions filtered by status."""
        # Arrange
        mock_result = Mock()
        mock_result.scalars.return_value.all.return_value = [sample_node_execution]
        mock_session.execute.return_value = mock_result

        # Act
        result = repository.get_executions_by_workflow_run(
            tenant_id="tenant-123",
            app_id="app-123",
            workflow_run_id="run-123",
            status="succeeded",
        )

        # Assert
        assert len(result) == 1
        assert result[0] == sample_node_execution
        mock_session.execute.assert_called_once()

    def test_get_executions_by_workflow_run_with_all_filters(
        self, repository, mock_session, mock_session_maker, sample_node_execution
    ):
        """Test getting executions with all filters applied."""
        # Arrange
        mock_result = Mock()
        mock_result.scalars.return_value.all.return_value = [sample_node_execution]
        mock_session.execute.return_value = mock_result

        # Act
        result = repository.get_executions_by_workflow_run(
            tenant_id="tenant-123",
            app_id="app-123",
            workflow_run_id="run-123",
            node_id="node-123",
            node_type="http-request",
            status="succeeded",
        )

        # Assert
        assert len(result) == 1
        assert result[0] == sample_node_execution
        mock_session.execute.assert_called_once()

    def test_get_execution_by_node_id_found(self, repository, mock_session, mock_session_maker, sample_node_execution):
        """Test getting execution by node_id when found."""
        # Arrange
        mock_session.scalar.return_value = sample_node_execution

        # Act
        result = repository.get_execution_by_node_id(
            tenant_id="tenant-123",
            app_id="app-123",
            workflow_run_id="run-123",
            node_id="node-123",
        )

        # Assert
        assert result == sample_node_execution
        mock_session.scalar.assert_called_once()

    def test_get_execution_by_node_id_not_found(self, repository, mock_session, mock_session_maker):
        """Test getting execution by node_id when not found."""
        # Arrange
        mock_session.scalar.return_value = None

        # Act
        result = repository.get_execution_by_node_id(
            tenant_id="tenant-123",
            app_id="app-123",
            workflow_run_id="run-123",
            node_id="node-123",
        )

        # Assert
        assert result is None
        mock_session.scalar.assert_called_once()
