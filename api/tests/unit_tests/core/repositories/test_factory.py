"""
Unit tests for the RepositoryFactory.

This module tests the factory pattern implementation for creating repository instances
based on configuration, including error handling.
"""

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.factory import (
    DifyCoreRepositoryFactory,
    RepositoryImportError,
)
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from libs.module_loading import import_string
from models import Account, EndUser
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
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
            CORE_WORKFLOW_EXECUTION_REPOSITORY=(
                "core.repositories.sqlalchemy_workflow_execution_repository.SQLAlchemyWorkflowExecutionRepository"
            ),
            CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY=(
                "core.repositories.sqlalchemy_workflow_node_execution_repository.SQLAlchemyWorkflowNodeExecutionRepository"
            ),
        )

    def test_import_string_success(self):
        """Test successful class import."""
        # Test importing a real class
        class_path = "core.repositories.sqlalchemy_workflow_execution_repository.SQLAlchemyWorkflowExecutionRepository"
        result = import_string(class_path)
        assert result is SQLAlchemyWorkflowExecutionRepository

    def test_import_string_invalid_path(self):
        """Test import with invalid module path."""
        with pytest.raises(ImportError) as exc_info:
            import_string("invalid.module.path")
        assert "No module named" in str(exc_info.value)

    def test_import_string_invalid_class_name(self):
        """Test import with invalid class name."""
        with pytest.raises(ImportError) as exc_info:
            import_string("core.repositories.factory.NonExistentClass")
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
        mock_user.id = "account-id"
        app_id = "test-app-id"
        triggered_from = WorkflowRunTriggeredFrom.APP_RUN

        result = DifyCoreRepositoryFactory.create_workflow_execution_repository(
            session_factory=sqlite_session_factory,
            tenant_id=RESOURCE_TENANT_ID,
            user=mock_user,
            app_id=app_id,
            triggered_from=triggered_from,
        )

        assert isinstance(result, SQLAlchemyWorkflowExecutionRepository)
        assert result._session_factory is sqlite_session_factory
        assert result._tenant_id == RESOURCE_TENANT_ID
        assert result._creator_user_id == mock_user.id
        assert result._creator_user_role == CreatorUserRole.ACCOUNT
        assert result._app_id == app_id
        assert result._triggered_from == triggered_from

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

        with pytest.raises(RepositoryImportError) as exc_info:
            DifyCoreRepositoryFactory.create_workflow_execution_repository(
                session_factory=sqlite_session_factory,
                tenant_id="",
                user=mock_user,
                app_id="test-app-id",
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            )
        assert "Failed to create WorkflowExecutionRepository" in str(exc_info.value)
        assert isinstance(exc_info.value.__cause__, ValueError)
        assert str(exc_info.value.__cause__) == "tenant_id is required"

    def test_create_workflow_node_execution_repository_success(self, sqlite_session_factory):
        """Test successful WorkflowNodeExecutionRepository creation."""
        # Create non-database dependencies
        mock_user = EndUser(id="end-user-id")
        app_id = "test-app-id"
        triggered_from = WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP

        result = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
            session_factory=sqlite_session_factory,
            tenant_id=RESOURCE_TENANT_ID,
            user=mock_user,
            app_id=app_id,
            triggered_from=triggered_from,
        )

        assert isinstance(result, SQLAlchemyWorkflowNodeExecutionRepository)
        assert result._session_factory is sqlite_session_factory
        assert result._tenant_id == RESOURCE_TENANT_ID
        assert result._user is mock_user
        assert result._creator_user_id == mock_user.id
        assert result._creator_user_role == CreatorUserRole.END_USER
        assert result._app_id == app_id
        assert result._triggered_from == triggered_from

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

        with pytest.raises(RepositoryImportError) as exc_info:
            DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
                session_factory=sqlite_session_factory,
                tenant_id="",
                user=mock_user,
                app_id="test-app-id",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
            )
        assert "Failed to create WorkflowNodeExecutionRepository" in str(exc_info.value)
        assert isinstance(exc_info.value.__cause__, ValueError)
        assert str(exc_info.value.__cause__) == "tenant_id is required"

    def test_repository_import_error_exception(self):
        """Test RepositoryImportError exception handling."""
        error_message = "Custom error message"
        error = RepositoryImportError(error_message)
        assert str(error) == error_message

    def test_create_with_engine_instead_of_sessionmaker(self, sqlite_engine: Engine):
        """Test repository creation with Engine instead of sessionmaker."""
        # Pass the real Engine directly instead of wrapping it in sessionmaker
        mock_user = Account(name="Test Account", email="test@example.com")
        mock_user.id = "account-id"
        app_id = "test-app-id"
        triggered_from = WorkflowRunTriggeredFrom.APP_RUN

        result = DifyCoreRepositoryFactory.create_workflow_execution_repository(
            session_factory=sqlite_engine,
            tenant_id=RESOURCE_TENANT_ID,
            user=mock_user,
            app_id=app_id,
            triggered_from=triggered_from,
        )

        assert isinstance(result, SQLAlchemyWorkflowExecutionRepository)
        with result._session_factory() as session:
            assert session.get_bind() is sqlite_engine
        assert result._tenant_id == RESOURCE_TENANT_ID
        assert result._creator_user_id == mock_user.id
        assert result._creator_user_role == CreatorUserRole.ACCOUNT
        assert result._app_id == app_id
        assert result._triggered_from == triggered_from
