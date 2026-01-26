"""Unit tests for WorkflowRunService node execution filtering and lookup."""

import threading
from unittest.mock import Mock, patch

import pytest

from models import Account, App, EndUser, WorkflowNodeExecutionModel, WorkflowRun
from repositories.api_workflow_node_execution_repository import DifyAPIWorkflowNodeExecutionRepository
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from services.workflow_run_service import WorkflowRunService


class TestWorkflowRunServiceNodeExecutions:
    """Test node execution filtering and lookup in WorkflowRunService."""

    @pytest.fixture
    def mock_node_execution_repo(self):
        """Create a mock node execution repository."""
        return Mock(spec=DifyAPIWorkflowNodeExecutionRepository)

    @pytest.fixture
    def mock_workflow_run_repo(self):
        """Create a mock workflow run repository."""
        return Mock(spec=APIWorkflowRunRepository)

    @pytest.fixture
    def mock_session_factory(self):
        """Create a mock session factory."""
        return Mock()

    @pytest.fixture
    def service(self, mock_node_execution_repo, mock_workflow_run_repo, mock_session_factory):
        """Create WorkflowRunService with mocked repositories."""
        with patch("services.workflow_run_service.DifyAPIRepositoryFactory") as mock_factory:
            mock_factory.create_api_workflow_node_execution_repository.return_value = mock_node_execution_repo
            mock_factory.create_api_workflow_run_repository.return_value = mock_workflow_run_repo

            service = WorkflowRunService(session_factory=mock_session_factory)
            service._node_execution_service_repo = mock_node_execution_repo
            service._workflow_run_repo = mock_workflow_run_repo
            return service

    @pytest.fixture
    def mock_app(self):
        """Create a mock App."""
        app = Mock(spec=App)
        app.id = "app-123"
        app.tenant_id = "tenant-123"
        return app

    @pytest.fixture
    def mock_account(self):
        """Create a mock Account."""
        account = Mock(spec=Account)
        account.id = "account-123"
        account.current_tenant_id = "tenant-123"
        account.tenant_id = None
        return account

    @pytest.fixture
    def mock_end_user(self):
        """Create a mock EndUser."""
        end_user = Mock(spec=EndUser)
        end_user.id = "end-user-123"
        end_user.tenant_id = "tenant-123"
        return end_user

    @pytest.fixture
    def mock_workflow_run(self):
        """Create a mock WorkflowRun."""
        workflow_run = Mock(spec=WorkflowRun)
        workflow_run.id = "run-123"
        workflow_run.tenant_id = "tenant-123"
        workflow_run.app_id = "app-123"
        return workflow_run

    @pytest.fixture
    def mock_node_execution(self):
        """Create a mock WorkflowNodeExecutionModel."""
        execution = Mock(spec=WorkflowNodeExecutionModel)
        execution.id = "execution-123"
        execution.node_id = "node-123"
        execution.node_type = "http-request"
        execution.status = "succeeded"
        return execution

    @patch("services.workflow_run_service.contexts")
    def test_get_workflow_run_node_executions_no_filters(
        self, mock_contexts, service, mock_app, mock_account, mock_workflow_run, mock_node_execution_repo, mock_node_execution
    ):
        """Test getting node executions without filters."""
        # Arrange
        mock_contexts.plugin_tool_providers.set = Mock()
        mock_contexts.plugin_tool_providers_lock.set = Mock()

        service.get_workflow_run = Mock(return_value=mock_workflow_run)
        mock_node_execution_repo.get_executions_by_workflow_run.return_value = [mock_node_execution]

        # Act
        result = service.get_workflow_run_node_executions(
            app_model=mock_app,
            run_id="run-123",
            user=mock_account,
        )

        # Assert
        assert len(result) == 1
        assert result[0] == mock_node_execution
        mock_node_execution_repo.get_executions_by_workflow_run.assert_called_once_with(
            tenant_id="tenant-123",
            app_id="app-123",
            workflow_run_id="run-123",
            node_id=None,
            node_type=None,
            status=None,
        )

    @patch("services.workflow_run_service.contexts")
    def test_get_workflow_run_node_executions_with_filters(
        self, mock_contexts, service, mock_app, mock_account, mock_workflow_run, mock_node_execution_repo, mock_node_execution
    ):
        """Test getting node executions with filters."""
        # Arrange
        mock_contexts.plugin_tool_providers.set = Mock()
        mock_contexts.plugin_tool_providers_lock.set = Mock()

        service.get_workflow_run = Mock(return_value=mock_workflow_run)
        mock_node_execution_repo.get_executions_by_workflow_run.return_value = [mock_node_execution]

        # Act
        result = service.get_workflow_run_node_executions(
            app_model=mock_app,
            run_id="run-123",
            user=mock_account,
            node_id="node-123",
            node_type="http-request",
            status="succeeded",
        )

        # Assert
        assert len(result) == 1
        mock_node_execution_repo.get_executions_by_workflow_run.assert_called_once_with(
            tenant_id="tenant-123",
            app_id="app-123",
            workflow_run_id="run-123",
            node_id="node-123",
            node_type="http-request",
            status="succeeded",
        )

    @patch("services.workflow_run_service.contexts")
    def test_get_workflow_run_node_executions_workflow_run_not_found(
        self, mock_contexts, service, mock_app, mock_account, mock_node_execution_repo
    ):
        """Test getting node executions when workflow run not found."""
        # Arrange
        mock_contexts.plugin_tool_providers.set = Mock()
        mock_contexts.plugin_tool_providers_lock.set = Mock()

        service.get_workflow_run = Mock(return_value=None)

        # Act
        result = service.get_workflow_run_node_executions(
            app_model=mock_app,
            run_id="run-123",
            user=mock_account,
        )

        # Assert
        assert result == []
        mock_node_execution_repo.get_executions_by_workflow_run.assert_not_called()

    @patch("services.workflow_run_service.contexts")
    def test_get_workflow_run_node_executions_with_end_user(
        self, mock_contexts, service, mock_app, mock_end_user, mock_workflow_run, mock_node_execution_repo, mock_node_execution
    ):
        """Test getting node executions with EndUser."""
        # Arrange
        mock_contexts.plugin_tool_providers.set = Mock()
        mock_contexts.plugin_tool_providers_lock.set = Mock()

        service.get_workflow_run = Mock(return_value=mock_workflow_run)
        mock_node_execution_repo.get_executions_by_workflow_run.return_value = [mock_node_execution]

        # Act
        result = service.get_workflow_run_node_executions(
            app_model=mock_app,
            run_id="run-123",
            user=mock_end_user,
        )

        # Assert
        assert len(result) == 1
        mock_node_execution_repo.get_executions_by_workflow_run.assert_called_once_with(
            tenant_id="tenant-123",
            app_id="app-123",
            workflow_run_id="run-123",
            node_id=None,
            node_type=None,
            status=None,
        )

    @patch("services.workflow_run_service.contexts")
    def test_get_workflow_run_node_execution_by_node_id_found(
        self, mock_contexts, service, mock_app, mock_account, mock_workflow_run, mock_node_execution_repo, mock_node_execution
    ):
        """Test getting node execution by node_id when found."""
        # Arrange
        mock_contexts.plugin_tool_providers.set = Mock()
        mock_contexts.plugin_tool_providers_lock.set = Mock()

        service.get_workflow_run = Mock(return_value=mock_workflow_run)
        mock_node_execution_repo.get_execution_by_node_id.return_value = mock_node_execution

        # Act
        result = service.get_workflow_run_node_execution_by_node_id(
            app_model=mock_app,
            run_id="run-123",
            node_id="node-123",
            user=mock_account,
        )

        # Assert
        assert result == mock_node_execution
        mock_node_execution_repo.get_execution_by_node_id.assert_called_once_with(
            tenant_id="tenant-123",
            app_id="app-123",
            workflow_run_id="run-123",
            node_id="node-123",
        )

    @patch("services.workflow_run_service.contexts")
    def test_get_workflow_run_node_execution_by_node_id_not_found(
        self, mock_contexts, service, mock_app, mock_account, mock_workflow_run, mock_node_execution_repo
    ):
        """Test getting node execution by node_id when not found."""
        # Arrange
        mock_contexts.plugin_tool_providers.set = Mock()
        mock_contexts.plugin_tool_providers_lock.set = Mock()

        service.get_workflow_run = Mock(return_value=mock_workflow_run)
        mock_node_execution_repo.get_execution_by_node_id.return_value = None

        # Act
        result = service.get_workflow_run_node_execution_by_node_id(
            app_model=mock_app,
            run_id="run-123",
            node_id="node-123",
            user=mock_account,
        )

        # Assert
        assert result is None
        mock_node_execution_repo.get_execution_by_node_id.assert_called_once()

    @patch("services.workflow_run_service.contexts")
    def test_get_workflow_run_node_execution_by_node_id_workflow_run_not_found(
        self, mock_contexts, service, mock_app, mock_account, mock_node_execution_repo
    ):
        """Test getting node execution by node_id when workflow run not found."""
        # Arrange
        mock_contexts.plugin_tool_providers.set = Mock()
        mock_contexts.plugin_tool_providers_lock.set = Mock()

        service.get_workflow_run = Mock(return_value=None)

        # Act
        result = service.get_workflow_run_node_execution_by_node_id(
            app_model=mock_app,
            run_id="run-123",
            node_id="node-123",
            user=mock_account,
        )

        # Assert
        assert result is None
        mock_node_execution_repo.get_execution_by_node_id.assert_not_called()

    def test_get_workflow_run_node_executions_raises_error_on_none_tenant_id(
        self, service, mock_app, mock_account, mock_workflow_run
    ):
        """Test that ValueError is raised when tenant_id is None."""
        # Arrange
        mock_account.current_tenant_id = None
        service.get_workflow_run = Mock(return_value=mock_workflow_run)

        # Act & Assert
        with pytest.raises(ValueError, match="User tenant_id cannot be None"):
            service.get_workflow_run_node_executions(
                app_model=mock_app,
                run_id="run-123",
                user=mock_account,
            )
