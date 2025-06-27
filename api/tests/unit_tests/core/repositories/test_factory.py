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

        # Create a mock interface with the same methods
        class MockInterface:
            def save(self):
                pass

            def get_by_id(self):
                pass

        # Should not raise an exception
        DifyCoreRepositoryFactory._validate_repository_interface(MockRepository, MockInterface)

    def test_validate_repository_interface_missing_methods(self):
        """Test interface validation with missing methods."""

        # Create a mock class that doesn't implement all required methods
        class IncompleteRepository:
            def save(self):
                pass

            # Missing get_by_id method

        # Create a mock interface with required methods
        class MockInterface:
            def save(self):
                pass

            def get_by_id(self):
                pass

        with pytest.raises(RepositoryImportError) as exc_info:
            DifyCoreRepositoryFactory._validate_repository_interface(IncompleteRepository, MockInterface)
        assert "does not implement required methods" in str(exc_info.value)
        assert "get_by_id" in str(exc_info.value)

    def test_validate_constructor_signature_success(self):
        """Test successful constructor signature validation."""

        class MockRepository:
            def __init__(self, session_factory, user, app_id, triggered_from):
                pass

        # Should not raise an exception
        DifyCoreRepositoryFactory._validate_constructor_signature(
            MockRepository, ["session_factory", "user", "app_id", "triggered_from"]
        )

    def test_validate_constructor_signature_missing_params(self):
        """Test constructor validation with missing parameters."""

        class IncompleteRepository:
            def __init__(self, session_factory, user):
                # Missing app_id and triggered_from parameters
                pass

        with pytest.raises(RepositoryImportError) as exc_info:
            DifyCoreRepositoryFactory._validate_constructor_signature(
                IncompleteRepository, ["session_factory", "user", "app_id", "triggered_from"]
            )
        assert "does not accept required parameters" in str(exc_info.value)
        assert "app_id" in str(exc_info.value)
        assert "triggered_from" in str(exc_info.value)

    def test_validate_constructor_signature_inspection_error(self, mocker: MockerFixture):
        """Test constructor validation when inspection fails."""
        # Mock inspect.signature to raise an exception
        mocker.patch("inspect.signature", side_effect=Exception("Inspection failed"))

        class MockRepository:
            def __init__(self, session_factory):
                pass

        with pytest.raises(RepositoryImportError) as exc_info:
            DifyCoreRepositoryFactory._validate_constructor_signature(MockRepository, ["session_factory"])
        assert "Failed to validate constructor signature" in str(exc_info.value)

    @patch("core.repositories.factory.dify_config")
    def test_create_workflow_execution_repository_success(self, mock_config, mocker: MockerFixture):
        """Test successful creation of WorkflowExecutionRepository."""
        # Setup mock configuration
        mock_config.WORKFLOW_EXECUTION_REPOSITORY = "unittest.mock.MagicMock"

        # Create mock dependencies
        mock_session_factory = MagicMock(spec=sessionmaker)
        mock_user = MagicMock(spec=Account)
        app_id = "test-app-id"
        triggered_from = WorkflowRunTriggeredFrom.APP_RUN

        # Mock the imported class to be a valid repository
        mock_repository_class = MagicMock()
        mock_repository_instance = MagicMock(spec=WorkflowExecutionRepository)
        mock_repository_class.return_value = mock_repository_instance

        # Mock the validation methods
        with (
            patch.object(DifyCoreRepositoryFactory, "_import_class", return_value=mock_repository_class),
            patch.object(DifyCoreRepositoryFactory, "_validate_repository_interface"),
            patch.object(DifyCoreRepositoryFactory, "_validate_constructor_signature"),
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
        mock_config.WORKFLOW_EXECUTION_REPOSITORY = "invalid.module.InvalidClass"

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
        mock_config.WORKFLOW_EXECUTION_REPOSITORY = "unittest.mock.MagicMock"

        mock_session_factory = MagicMock(spec=sessionmaker)
        mock_user = MagicMock(spec=Account)

        # Mock import to succeed but validation to fail
        mock_repository_class = MagicMock()
        with (
            patch.object(DifyCoreRepositoryFactory, "_import_class", return_value=mock_repository_class),
            patch.object(
                DifyCoreRepositoryFactory,
                "_validate_repository_interface",
                side_effect=RepositoryImportError("Interface validation failed"),
            ),
        ):
            with pytest.raises(RepositoryImportError) as exc_info:
                DifyCoreRepositoryFactory.create_workflow_execution_repository(
                    session_factory=mock_session_factory,
                    user=mock_user,
                    app_id="test-app-id",
                    triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                )
            assert "Interface validation failed" in str(exc_info.value)

    @patch("core.repositories.factory.dify_config")
    def test_create_workflow_execution_repository_instantiation_error(self, mock_config, mocker: MockerFixture):
        """Test WorkflowExecutionRepository creation with instantiation error."""
        # Setup mock configuration
        mock_config.WORKFLOW_EXECUTION_REPOSITORY = "unittest.mock.MagicMock"

        mock_session_factory = MagicMock(spec=sessionmaker)
        mock_user = MagicMock(spec=Account)

        # Mock import and validation to succeed but instantiation to fail
        mock_repository_class = MagicMock(side_effect=Exception("Instantiation failed"))
        with (
            patch.object(DifyCoreRepositoryFactory, "_import_class", return_value=mock_repository_class),
            patch.object(DifyCoreRepositoryFactory, "_validate_repository_interface"),
            patch.object(DifyCoreRepositoryFactory, "_validate_constructor_signature"),
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
    def test_create_workflow_node_execution_repository_success(self, mock_config, mocker: MockerFixture):
        """Test successful creation of WorkflowNodeExecutionRepository."""
        # Setup mock configuration
        mock_config.WORKFLOW_NODE_EXECUTION_REPOSITORY = "unittest.mock.MagicMock"

        # Create mock dependencies
        mock_session_factory = MagicMock(spec=sessionmaker)
        mock_user = MagicMock(spec=EndUser)
        app_id = "test-app-id"
        triggered_from = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN

        # Mock the imported class to be a valid repository
        mock_repository_class = MagicMock()
        mock_repository_instance = MagicMock(spec=WorkflowNodeExecutionRepository)
        mock_repository_class.return_value = mock_repository_instance

        # Mock the validation methods
        with (
            patch.object(DifyCoreRepositoryFactory, "_import_class", return_value=mock_repository_class),
            patch.object(DifyCoreRepositoryFactory, "_validate_repository_interface"),
            patch.object(DifyCoreRepositoryFactory, "_validate_constructor_signature"),
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
        mock_config.WORKFLOW_NODE_EXECUTION_REPOSITORY = "invalid.module.InvalidClass"

        mock_session_factory = MagicMock(spec=sessionmaker)
        mock_user = MagicMock(spec=EndUser)

        with pytest.raises(RepositoryImportError) as exc_info:
            DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
                session_factory=mock_session_factory,
                user=mock_user,
                app_id="test-app-id",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )
        assert "Cannot import repository class" in str(exc_info.value)

    def test_repository_import_error_exception(self):
        """Test RepositoryImportError exception."""
        error_message = "Test error message"
        exception = RepositoryImportError(error_message)
        assert str(exception) == error_message
        assert isinstance(exception, Exception)

    @patch("core.repositories.factory.dify_config")
    def test_create_with_engine_instead_of_sessionmaker(self, mock_config, mocker: MockerFixture):
        """Test repository creation with Engine instead of sessionmaker."""
        # Setup mock configuration
        mock_config.WORKFLOW_EXECUTION_REPOSITORY = "unittest.mock.MagicMock"

        # Create mock dependencies with Engine instead of sessionmaker
        mock_engine = MagicMock(spec=Engine)
        mock_user = MagicMock(spec=Account)

        # Mock the imported class to be a valid repository
        mock_repository_class = MagicMock()
        mock_repository_instance = MagicMock(spec=WorkflowExecutionRepository)
        mock_repository_class.return_value = mock_repository_instance

        # Mock the validation methods
        with (
            patch.object(DifyCoreRepositoryFactory, "_import_class", return_value=mock_repository_class),
            patch.object(DifyCoreRepositoryFactory, "_validate_repository_interface"),
            patch.object(DifyCoreRepositoryFactory, "_validate_constructor_signature"),
        ):
            result = DifyCoreRepositoryFactory.create_workflow_execution_repository(
                session_factory=mock_engine,  # Using Engine instead of sessionmaker
                user=mock_user,
                app_id="test-app-id",
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            )

            # Verify the repository was created with the Engine
            mock_repository_class.assert_called_once_with(
                session_factory=mock_engine,
                user=mock_user,
                app_id="test-app-id",
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            )
            assert result is mock_repository_instance

    @patch("core.repositories.factory.dify_config")
    def test_create_workflow_node_execution_repository_validation_error(self, mock_config):
        """Test WorkflowNodeExecutionRepository creation with validation error."""
        # Setup mock configuration
        mock_config.WORKFLOW_NODE_EXECUTION_REPOSITORY = "unittest.mock.MagicMock"

        mock_session_factory = MagicMock(spec=sessionmaker)
        mock_user = MagicMock(spec=EndUser)

        # Mock import to succeed but validation to fail
        mock_repository_class = MagicMock()
        with (
            patch.object(DifyCoreRepositoryFactory, "_import_class", return_value=mock_repository_class),
            patch.object(
                DifyCoreRepositoryFactory,
                "_validate_repository_interface",
                side_effect=RepositoryImportError("Interface validation failed"),
            ),
        ):
            with pytest.raises(RepositoryImportError) as exc_info:
                DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
                    session_factory=mock_session_factory,
                    user=mock_user,
                    app_id="test-app-id",
                    triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                )
            assert "Interface validation failed" in str(exc_info.value)

    @patch("core.repositories.factory.dify_config")
    def test_create_workflow_node_execution_repository_instantiation_error(self, mock_config):
        """Test WorkflowNodeExecutionRepository creation with instantiation error."""
        # Setup mock configuration
        mock_config.WORKFLOW_NODE_EXECUTION_REPOSITORY = "unittest.mock.MagicMock"

        mock_session_factory = MagicMock(spec=sessionmaker)
        mock_user = MagicMock(spec=EndUser)

        # Mock import and validation to succeed but instantiation to fail
        mock_repository_class = MagicMock(side_effect=Exception("Instantiation failed"))
        with (
            patch.object(DifyCoreRepositoryFactory, "_import_class", return_value=mock_repository_class),
            patch.object(DifyCoreRepositoryFactory, "_validate_repository_interface"),
            patch.object(DifyCoreRepositoryFactory, "_validate_constructor_signature"),
        ):
            with pytest.raises(RepositoryImportError) as exc_info:
                DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
                    session_factory=mock_session_factory,
                    user=mock_user,
                    app_id="test-app-id",
                    triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                )
            assert "Failed to create WorkflowNodeExecutionRepository" in str(exc_info.value)

    def test_validate_repository_interface_with_private_methods(self):
        """Test interface validation ignores private methods."""

        # Create a mock class with private methods
        class MockRepository:
            def save(self):
                pass

            def get_by_id(self):
                pass

            def _private_method(self):
                pass

        # Create a mock interface with private methods
        class MockInterface:
            def save(self):
                pass

            def get_by_id(self):
                pass

            def _private_method(self):
                pass

        # Should not raise an exception (private methods are ignored)
        DifyCoreRepositoryFactory._validate_repository_interface(MockRepository, MockInterface)

    def test_validate_constructor_signature_with_extra_params(self):
        """Test constructor validation with extra parameters (should pass)."""

        class MockRepository:
            def __init__(self, session_factory, user, app_id, triggered_from, extra_param=None):
                pass

        # Should not raise an exception (extra parameters are allowed)
        DifyCoreRepositoryFactory._validate_constructor_signature(
            MockRepository, ["session_factory", "user", "app_id", "triggered_from"]
        )

    def test_validate_constructor_signature_with_kwargs(self):
        """Test constructor validation with **kwargs (current implementation doesn't support this)."""

        class MockRepository:
            def __init__(self, session_factory, user, **kwargs):
                pass

        # Current implementation doesn't handle **kwargs, so this should raise an exception
        with pytest.raises(RepositoryImportError) as exc_info:
            DifyCoreRepositoryFactory._validate_constructor_signature(
                MockRepository, ["session_factory", "user", "app_id", "triggered_from"]
            )
        assert "does not accept required parameters" in str(exc_info.value)
        assert "app_id" in str(exc_info.value)
        assert "triggered_from" in str(exc_info.value)
