"""
Unit tests for the RepositoryFactory.

This module tests the factory pattern implementation for creating repository instances
based on configuration, including error handling and validation.
"""

from unittest.mock import MagicMock, patch

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.repositories.factory import DifyCoreRepositoryFactory, RepositoryImportError
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from core.workflow.repositories.workflow_node_execution_repository import WorkflowNodeExecutionRepository
from models import Account, EndUser
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import WorkflowNodeExecutionTriggeredFrom


class TestRepositoryFactory:
    """Test cases for RepositoryFactory."""

    def test_import_class_success(self):
        """Test successful class import."""
        # Test importing a real class
        class_path = "unittest.mock.MagicMock"
        result = DifyCoreRepositoryFactory._import_class(class_path)
        assert result is MagicMock

    def test_import_class_invalid_path(self):
        """Test import with invalid module path."""
        with pytest.raises(RepositoryImportError) as exc_info:
            DifyCoreRepositoryFactory._import_class("invalid.module.path")
        assert "Cannot import repository class" in str(exc_info.value)

    def test_import_class_invalid_class_name(self):
        """Test import with invalid class name."""
        with pytest.raises(RepositoryImportError) as exc_info:
            DifyCoreRepositoryFactory._import_class("unittest.mock.NonExistentClass")
        assert "Cannot import repository class" in str(exc_info.value)

    def test_import_class_malformed_path(self):
        """Test import with malformed path (no dots)."""
        with pytest.raises(RepositoryImportError) as exc_info:
            DifyCoreRepositoryFactory._import_class("invalidpath")
        assert "Cannot import repository class" in str(exc_info.value)

    def test_validate_repository_interface_success(self):
        """Test successful interface validation."""

        # Create a mock class that implements the required methods
        class MockRepository:
            def save(self):
                pass

            def get_by_id(self):
                pass

        # Create a mock interface class
        class MockInterface:
            def save(self):
                pass

            def get_by_id(self):
                pass

        # Should not raise an exception when all methods are present
        DifyCoreRepositoryFactory._validate_repository_interface(MockRepository, MockInterface)

    def test_validate_repository_interface_missing_methods(self):
        """Test interface validation with missing methods."""

        # Create a mock class that's missing required methods
        class IncompleteRepository:
            def save(self):
                pass

            # Missing get_by_id method

        # Create a mock interface that requires both methods
        class MockInterface:
            def save(self):
                pass

            def get_by_id(self):
                pass

            def missing_method(self):
                pass

        with pytest.raises(RepositoryImportError) as exc_info:
            DifyCoreRepositoryFactory._validate_repository_interface(IncompleteRepository, MockInterface)
        assert "does not implement required methods" in str(exc_info.value)

    def test_validate_repository_interface_with_private_methods(self):
        """Test that private methods are ignored during interface validation."""

        class MockRepository:
            def save(self):
                pass

            def _private_method(self):
                pass

        # Create a mock interface with private methods
        class MockInterface:
            def save(self):
                pass

            def _private_method(self):
                pass

        # Should not raise exception - private methods should be ignored
        DifyCoreRepositoryFactory._validate_repository_interface(MockRepository, MockInterface)

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

        # Mock the validation methods
        with (
            patch.object(DifyCoreRepositoryFactory, "_import_class", return_value=mock_repository_class),
            patch.object(DifyCoreRepositoryFactory, "_validate_repository_interface"),
        ):
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
        assert "Cannot import repository class" in str(exc_info.value)

    @patch("core.repositories.factory.dify_config")
    def test_create_workflow_execution_repository_validation_error(self, mock_config, mocker: MockerFixture):
        """Test WorkflowExecutionRepository creation with validation error."""
        # Setup mock configuration
        mock_config.CORE_WORKFLOW_EXECUTION_REPOSITORY = "unittest.mock.MagicMock"

        mock_session_factory = MagicMock(spec=sessionmaker)
        mock_user = MagicMock(spec=Account)

        # Mock the import to succeed but validation to fail
        mock_repository_class = MagicMock()
        mocker.patch.object(DifyCoreRepositoryFactory, "_import_class", return_value=mock_repository_class)
        mocker.patch.object(
            DifyCoreRepositoryFactory,
            "_validate_repository_interface",
            side_effect=RepositoryImportError("Interface validation failed"),
        )

        with pytest.raises(RepositoryImportError) as exc_info:
            DifyCoreRepositoryFactory.create_workflow_execution_repository(
                session_factory=mock_session_factory,
                user=mock_user,
                app_id="test-app-id",
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            )
        assert "Interface validation failed" in str(exc_info.value)

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

        # Mock the validation methods to succeed
        with (
            patch.object(DifyCoreRepositoryFactory, "_import_class", return_value=mock_repository_class),
            patch.object(DifyCoreRepositoryFactory, "_validate_repository_interface"),
        ):
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

        # Mock the validation methods
        with (
            patch.object(DifyCoreRepositoryFactory, "_import_class", return_value=mock_repository_class),
            patch.object(DifyCoreRepositoryFactory, "_validate_repository_interface"),
        ):
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
        assert "Cannot import repository class" in str(exc_info.value)

    @patch("core.repositories.factory.dify_config")
    def test_create_workflow_node_execution_repository_validation_error(self, mock_config, mocker: MockerFixture):
        """Test WorkflowNodeExecutionRepository creation with validation error."""
        # Setup mock configuration
        mock_config.CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY = "unittest.mock.MagicMock"

        mock_session_factory = MagicMock(spec=sessionmaker)
        mock_user = MagicMock(spec=EndUser)

        # Mock the import to succeed but validation to fail
        mock_repository_class = MagicMock()
        mocker.patch.object(DifyCoreRepositoryFactory, "_import_class", return_value=mock_repository_class)
        mocker.patch.object(
            DifyCoreRepositoryFactory,
            "_validate_repository_interface",
            side_effect=RepositoryImportError("Interface validation failed"),
        )

        with pytest.raises(RepositoryImportError) as exc_info:
            DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
                session_factory=mock_session_factory,
                user=mock_user,
                app_id="test-app-id",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
            )
        assert "Interface validation failed" in str(exc_info.value)

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

        # Mock the validation methods to succeed
        with (
            patch.object(DifyCoreRepositoryFactory, "_import_class", return_value=mock_repository_class),
            patch.object(DifyCoreRepositoryFactory, "_validate_repository_interface"),
        ):
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

        # Mock the validation methods
        with (
            patch.object(DifyCoreRepositoryFactory, "_import_class", return_value=mock_repository_class),
            patch.object(DifyCoreRepositoryFactory, "_validate_repository_interface"),
        ):
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
