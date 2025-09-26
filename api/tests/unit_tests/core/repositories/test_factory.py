"""
Unit tests for the RepositoryFactory.

This module tests the factory pattern implementation for creating repository instances
based on configuration, including error handling.
"""

from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.repositories.factory import DifyCoreRepositoryFactory, RepositoryImportError
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from core.workflow.repositories.workflow_node_execution_repository import WorkflowNodeExecutionRepository
from libs.module_loading import import_string
from models import Account, EndUser
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import WorkflowNodeExecutionTriggeredFrom


class TestRepositoryFactory:
    """Test cases for RepositoryFactory."""

    def test_import_string_success(self):
        """Test successful class import."""
        # Test importing a real class
        class_path = "unittest.mock.MagicMock"
        result = import_string(class_path)
        assert result is MagicMock

    def test_import_string_invalid_path(self):
        """Test import with invalid module path."""
        with pytest.raises(ImportError) as exc_info:
            import_string("invalid.module.path")
        assert "No module named" in str(exc_info.value)

    def test_import_string_invalid_class_name(self):
        """Test import with invalid class name."""
        with pytest.raises(ImportError) as exc_info:
            import_string("unittest.mock.NonExistentClass")
        assert "does not define" in str(exc_info.value)

    def test_import_string_malformed_path(self):
        """Test import with malformed path (no dots)."""
        with pytest.raises(ImportError) as exc_info:
            import_string("invalidpath")
        assert "doesn't look like a module path" in str(exc_info.value)

    @patch("core.repositories.factory.dify_config")
    def test_create_workflow_execution_repository_success(self, mock_config):
        """Test successful WorkflowExecutionRepository creation."""
        # Setup mock configuration
        mock_config.CORE_WORKFLOW_EXECUTION_REPOSITORY = "unittest.mock.MagicMock"

        # Create mock dependencies
        mock_session_factory = MagicMock(spec=sessionmaker)
        mock_user = MagicMock(spec=Account)
        app_id = "test-app-id"
        triggered_from = WorkflowRunTriggeredFrom.APP_RUN

        # Create mock repository class and instance
        mock_repository_class = MagicMock()
        mock_repository_instance = MagicMock(spec=WorkflowExecutionRepository)
        mock_repository_class.return_value = mock_repository_instance

        # Mock import_string
        with patch("core.repositories.factory.import_string", return_value=mock_repository_class):
            result = DifyCoreRepositoryFactory.create_workflow_execution_repository(
                session_factory=mock_session_factory,
                user=mock_user,
                app_id=app_id,
                triggered_from=triggered_from,
            )

            # Verify the repository was created with correct parameters
            mock_repository_class.assert_called_once_with(
                session_factory=mock_session_factory,
                user=mock_user,
                app_id=app_id,
                triggered_from=triggered_from,
            )
            assert result is mock_repository_instance

    @patch("core.repositories.factory.dify_config")
    def test_create_workflow_execution_repository_import_error(self, mock_config):
        """Test WorkflowExecutionRepository creation with import error."""
        # Setup mock configuration with invalid class path
        mock_config.CORE_WORKFLOW_EXECUTION_REPOSITORY = "invalid.module.InvalidClass"

        mock_session_factory = MagicMock(spec=sessionmaker)
        mock_user = MagicMock(spec=Account)

        with pytest.raises(RepositoryImportError) as exc_info:
            DifyCoreRepositoryFactory.create_workflow_execution_repository(
                session_factory=mock_session_factory,
                user=mock_user,
                app_id="test-app-id",
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            )
        assert "Failed to create WorkflowExecutionRepository" in str(exc_info.value)

    @patch("core.repositories.factory.dify_config")
    def test_create_workflow_execution_repository_instantiation_error(self, mock_config):
        """Test WorkflowExecutionRepository creation with instantiation error."""
        # Setup mock configuration
        mock_config.CORE_WORKFLOW_EXECUTION_REPOSITORY = "unittest.mock.MagicMock"

        mock_session_factory = MagicMock(spec=sessionmaker)
        mock_user = MagicMock(spec=Account)

        # Create a mock repository class that raises exception on instantiation
        mock_repository_class = MagicMock()
        mock_repository_class.side_effect = Exception("Instantiation failed")

        # Mock import_string to return a failing class
        with patch("core.repositories.factory.import_string", return_value=mock_repository_class):
            with pytest.raises(RepositoryImportError) as exc_info:
                DifyCoreRepositoryFactory.create_workflow_execution_repository(
                    session_factory=mock_session_factory,
                    user=mock_user,
                    app_id="test-app-id",
                    triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                )
            assert "Failed to create WorkflowExecutionRepository" in str(exc_info.value)

    @patch("core.repositories.factory.dify_config")
    def test_create_workflow_node_execution_repository_success(self, mock_config):
        """Test successful WorkflowNodeExecutionRepository creation."""
        # Setup mock configuration
        mock_config.CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY = "unittest.mock.MagicMock"

        # Create mock dependencies
        mock_session_factory = MagicMock(spec=sessionmaker)
        mock_user = MagicMock(spec=EndUser)
        app_id = "test-app-id"
        triggered_from = WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP

        # Create mock repository class and instance
        mock_repository_class = MagicMock()
        mock_repository_instance = MagicMock(spec=WorkflowNodeExecutionRepository)
        mock_repository_class.return_value = mock_repository_instance

        # Mock import_string
        with patch("core.repositories.factory.import_string", return_value=mock_repository_class):
            result = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
                session_factory=mock_session_factory,
                user=mock_user,
                app_id=app_id,
                triggered_from=triggered_from,
            )

            # Verify the repository was created with correct parameters
            mock_repository_class.assert_called_once_with(
                session_factory=mock_session_factory,
                user=mock_user,
                app_id=app_id,
                triggered_from=triggered_from,
            )
            assert result is mock_repository_instance

    @patch("core.repositories.factory.dify_config")
    def test_create_workflow_node_execution_repository_import_error(self, mock_config):
        """Test WorkflowNodeExecutionRepository creation with import error."""
        # Setup mock configuration with invalid class path
        mock_config.CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY = "invalid.module.InvalidClass"

        mock_session_factory = MagicMock(spec=sessionmaker)
        mock_user = MagicMock(spec=EndUser)

        with pytest.raises(RepositoryImportError) as exc_info:
            DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
                session_factory=mock_session_factory,
                user=mock_user,
                app_id="test-app-id",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
            )
        assert "Failed to create WorkflowNodeExecutionRepository" in str(exc_info.value)

    @patch("core.repositories.factory.dify_config")
    def test_create_workflow_node_execution_repository_instantiation_error(self, mock_config):
        """Test WorkflowNodeExecutionRepository creation with instantiation error."""
        # Setup mock configuration
        mock_config.CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY = "unittest.mock.MagicMock"

        mock_session_factory = MagicMock(spec=sessionmaker)
        mock_user = MagicMock(spec=EndUser)

        # Create a mock repository class that raises exception on instantiation
        mock_repository_class = MagicMock()
        mock_repository_class.side_effect = Exception("Instantiation failed")

        # Mock import_string to return a failing class
        with patch("core.repositories.factory.import_string", return_value=mock_repository_class):
            with pytest.raises(RepositoryImportError) as exc_info:
                DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
                    session_factory=mock_session_factory,
                    user=mock_user,
                    app_id="test-app-id",
                    triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
                )
            assert "Failed to create WorkflowNodeExecutionRepository" in str(exc_info.value)

    def test_repository_import_error_exception(self):
        """Test RepositoryImportError exception handling."""
        error_message = "Custom error message"
        error = RepositoryImportError(error_message)
        assert str(error) == error_message

    @patch("core.repositories.factory.dify_config")
    def test_create_with_engine_instead_of_sessionmaker(self, mock_config):
        """Test repository creation with Engine instead of sessionmaker."""
        # Setup mock configuration
        mock_config.CORE_WORKFLOW_EXECUTION_REPOSITORY = "unittest.mock.MagicMock"

        # Create mock dependencies using Engine instead of sessionmaker
        mock_engine = MagicMock(spec=Engine)
        mock_user = MagicMock(spec=Account)
        app_id = "test-app-id"
        triggered_from = WorkflowRunTriggeredFrom.APP_RUN

        # Create mock repository class and instance
        mock_repository_class = MagicMock()
        mock_repository_instance = MagicMock(spec=WorkflowExecutionRepository)
        mock_repository_class.return_value = mock_repository_instance

        # Mock import_string
        with patch("core.repositories.factory.import_string", return_value=mock_repository_class):
            result = DifyCoreRepositoryFactory.create_workflow_execution_repository(
                session_factory=mock_engine,  # Using Engine instead of sessionmaker
                user=mock_user,
                app_id=app_id,
                triggered_from=triggered_from,
            )

            # Verify the repository was created with correct parameters
            mock_repository_class.assert_called_once_with(
                session_factory=mock_engine,
                user=mock_user,
                app_id=app_id,
                triggered_from=triggered_from,
            )
            assert result is mock_repository_instance
