"""
Unit tests for the RepositoryFactory.

This module tests the factory pattern implementation for creating repository instances
based on configuration, including error handling.
"""

from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.factory import (
    DifyCoreRepositoryFactory,
    RepositoryImportError,
    WorkflowExecutionRepository,
    WorkflowNodeExecutionRepository,
)
from libs.module_loading import import_string
from models import Account, EndUser
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import WorkflowNodeExecutionTriggeredFrom

RESOURCE_TENANT_ID = "resource-tenant-id"


@pytest.fixture
def sqlite_session_factory(sqlite_engine: Engine) -> sessionmaker[Session]:
    """Return a real session factory bound to the test's isolated SQLite engine."""
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with factory() as session:
        assert session.get_bind() is sqlite_engine
    return factory


class TestRepositoryFactory:
    """Test cases for RepositoryFactory."""

    @pytest.fixture(autouse=True)
    def _repository_config(self, config_overrides) -> None:
        config_overrides(
            CORE_WORKFLOW_EXECUTION_REPOSITORY="unittest.mock.MagicMock",
            CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY="unittest.mock.MagicMock",
        )

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

    def test_create_workflow_execution_repository_success(self, sqlite_session_factory):
        """Test successful WorkflowExecutionRepository creation."""
        # Create non-database dependencies
        mock_user = Account(name="Test Account", email="test@example.com")
        app_id = "test-app-id"
        triggered_from = WorkflowRunTriggeredFrom.APP_RUN

        # Create mock repository class and instance
        mock_repository_class = MagicMock()
        mock_repository_instance = MagicMock(spec=WorkflowExecutionRepository)
        mock_repository_class.return_value = mock_repository_instance

        # Mock import_string
        with patch("core.repositories.factory.import_string", return_value=mock_repository_class, autospec=True):
            result = DifyCoreRepositoryFactory.create_workflow_execution_repository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=mock_user,
                app_id=app_id,
                triggered_from=triggered_from,
            )

            # Verify the repository was created with correct parameters
            mock_repository_class.assert_called_once_with(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=mock_user,
                app_id=app_id,
                triggered_from=triggered_from,
            )
            assert result is mock_repository_instance

    def test_create_workflow_execution_repository_import_error(self, sqlite_session_factory, config_overrides):
        """Test WorkflowExecutionRepository creation with import error."""
        config_overrides(CORE_WORKFLOW_EXECUTION_REPOSITORY="invalid.module.InvalidClass")

        mock_user = Account(name="Test Account", email="test@example.com")

        with pytest.raises(RepositoryImportError) as exc_info:
            DifyCoreRepositoryFactory.create_workflow_execution_repository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=mock_user,
                app_id="test-app-id",
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            )
        assert "Failed to create WorkflowExecutionRepository" in str(exc_info.value)

    def test_create_workflow_execution_repository_instantiation_error(self, sqlite_session_factory):
        """Test WorkflowExecutionRepository creation with instantiation error."""
        mock_user = Account(name="Test Account", email="test@example.com")

        # Create a mock repository class that raises exception on instantiation
        mock_repository_class = MagicMock()
        mock_repository_class.side_effect = Exception("Instantiation failed")

        # Mock import_string to return a failing class
        with patch("core.repositories.factory.import_string", return_value=mock_repository_class, autospec=True):
            with pytest.raises(RepositoryImportError) as exc_info:
                DifyCoreRepositoryFactory.create_workflow_execution_repository(
                    session_factory=sqlite_session_factory,
                    tenant_id=RESOURCE_TENANT_ID,
                    user=mock_user,
                    app_id="test-app-id",
                    triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                )
            assert "Failed to create WorkflowExecutionRepository" in str(exc_info.value)

    def test_create_workflow_node_execution_repository_success(self, sqlite_session_factory):
        """Test successful WorkflowNodeExecutionRepository creation."""
        # Create non-database dependencies
        mock_user = EndUser()
        app_id = "test-app-id"
        triggered_from = WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP

        # Create mock repository class and instance
        mock_repository_class = MagicMock()
        mock_repository_instance = MagicMock(spec=WorkflowNodeExecutionRepository)
        mock_repository_class.return_value = mock_repository_instance

        # Mock import_string
        with patch("core.repositories.factory.import_string", return_value=mock_repository_class, autospec=True):
            result = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=mock_user,
                app_id=app_id,
                triggered_from=triggered_from,
            )

            # Verify the repository was created with correct parameters
            mock_repository_class.assert_called_once_with(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=mock_user,
                app_id=app_id,
                triggered_from=triggered_from,
            )
            assert result is mock_repository_instance

    def test_create_workflow_node_execution_repository_import_error(self, sqlite_session_factory, config_overrides):
        """Test WorkflowNodeExecutionRepository creation with import error."""
        config_overrides(CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY="invalid.module.InvalidClass")

        mock_user = EndUser()

        with pytest.raises(RepositoryImportError) as exc_info:
            DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=mock_user,
                app_id="test-app-id",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
            )
        assert "Failed to create WorkflowNodeExecutionRepository" in str(exc_info.value)

    def test_create_workflow_node_execution_repository_instantiation_error(self, sqlite_session_factory):
        """Test WorkflowNodeExecutionRepository creation with instantiation error."""
        mock_user = EndUser()

        # Create a mock repository class that raises exception on instantiation
        mock_repository_class = MagicMock()
        mock_repository_class.side_effect = Exception("Instantiation failed")

        # Mock import_string to return a failing class
        with patch("core.repositories.factory.import_string", return_value=mock_repository_class, autospec=True):
            with pytest.raises(RepositoryImportError) as exc_info:
                DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
                    session_factory=sqlite_session_factory,
                    tenant_id=RESOURCE_TENANT_ID,
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

    def test_create_with_engine_instead_of_sessionmaker(self, sqlite_engine: Engine):
        """Test repository creation with Engine instead of sessionmaker."""
        # Pass the real Engine directly instead of wrapping it in sessionmaker
        mock_user = Account(name="Test Account", email="test@example.com")
        app_id = "test-app-id"
        triggered_from = WorkflowRunTriggeredFrom.APP_RUN

        # Create mock repository class and instance
        mock_repository_class = MagicMock()
        mock_repository_instance = MagicMock(spec=WorkflowExecutionRepository)
        mock_repository_class.return_value = mock_repository_instance

        # Mock import_string
        with patch("core.repositories.factory.import_string", return_value=mock_repository_class, autospec=True):
            result = DifyCoreRepositoryFactory.create_workflow_execution_repository(
                session_factory=sqlite_engine,
                tenant_id=RESOURCE_TENANT_ID,
                user=mock_user,
                app_id=app_id,
                triggered_from=triggered_from,
            )

            # Verify the repository was created with correct parameters
            mock_repository_class.assert_called_once_with(
                session_factory=sqlite_engine,
                tenant_id=RESOURCE_TENANT_ID,
                user=mock_user,
                app_id=app_id,
                triggered_from=triggered_from,
            )
            assert result is mock_repository_instance
