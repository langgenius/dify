"""
Unit tests for CeleryWorkflowExecutionRepository.

These tests verify the Celery-based asynchronous storage functionality
for workflow execution data.
"""

from unittest.mock import Mock, patch
from uuid import uuid4

import pytest

from core.repositories.celery_workflow_execution_repository import CeleryWorkflowExecutionRepository
from core.workflow.entities.workflow_execution import WorkflowExecution, WorkflowType
from libs.datetime_utils import naive_utc_now
from models import Account, EndUser
from models.enums import WorkflowRunTriggeredFrom


@pytest.fixture
def mock_session_factory():
    """Mock SQLAlchemy session factory."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    # Create a real sessionmaker with in-memory SQLite for testing
    engine = create_engine("sqlite:///:memory:")
    return sessionmaker(bind=engine)


@pytest.fixture
def mock_account():
    """Mock Account user."""
    account = Mock(spec=Account)
    account.id = str(uuid4())
    account.current_tenant_id = str(uuid4())
    return account


@pytest.fixture
def mock_end_user():
    """Mock EndUser."""
    user = Mock(spec=EndUser)
    user.id = str(uuid4())
    user.tenant_id = str(uuid4())
    return user


@pytest.fixture
def sample_workflow_execution():
    """Sample WorkflowExecution for testing."""
    return WorkflowExecution.new(
        id_=str(uuid4()),
        workflow_id=str(uuid4()),
        workflow_type=WorkflowType.WORKFLOW,
        workflow_version="1.0",
        graph={"nodes": [], "edges": []},
        inputs={"input1": "value1"},
        started_at=naive_utc_now(),
    )


class TestCeleryWorkflowExecutionRepository:
    """Test cases for CeleryWorkflowExecutionRepository."""

    def test_init_with_sessionmaker(self, mock_session_factory, mock_account):
        """Test repository initialization with sessionmaker."""
        app_id = "test-app-id"
        triggered_from = WorkflowRunTriggeredFrom.APP_RUN

        repo = CeleryWorkflowExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id=app_id,
            triggered_from=triggered_from,
        )

        assert repo._tenant_id == mock_account.current_tenant_id
        assert repo._app_id == app_id
        assert repo._triggered_from == triggered_from
        assert repo._creator_user_id == mock_account.id
        assert repo._creator_user_role is not None

    def test_init_basic_functionality(self, mock_session_factory, mock_account):
        """Test repository initialization basic functionality."""
        repo = CeleryWorkflowExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        )

        # Verify basic initialization
        assert repo._tenant_id == mock_account.current_tenant_id
        assert repo._app_id == "test-app"
        assert repo._triggered_from == WorkflowRunTriggeredFrom.DEBUGGING

    def test_init_with_end_user(self, mock_session_factory, mock_end_user):
        """Test repository initialization with EndUser."""
        repo = CeleryWorkflowExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_end_user,
            app_id="test-app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        assert repo._tenant_id == mock_end_user.tenant_id

    def test_init_without_tenant_id_raises_error(self, mock_session_factory):
        """Test that initialization fails without tenant_id."""
        # Create a mock Account with no tenant_id
        user = Mock(spec=Account)
        user.current_tenant_id = None
        user.id = str(uuid4())

        with pytest.raises(ValueError, match="User must have a tenant_id"):
            CeleryWorkflowExecutionRepository(
                session_factory=mock_session_factory,
                user=user,
                app_id="test-app",
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            )

    @patch("core.repositories.celery_workflow_execution_repository.save_workflow_execution_task")
    def test_save_queues_celery_task(self, mock_task, mock_session_factory, mock_account, sample_workflow_execution):
        """Test that save operation queues a Celery task without tracking."""
        repo = CeleryWorkflowExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        repo.save(sample_workflow_execution)

        # Verify Celery task was queued with correct parameters
        mock_task.delay.assert_called_once()
        call_args = mock_task.delay.call_args[1]

        assert call_args["execution_data"] == sample_workflow_execution.model_dump()
        assert call_args["tenant_id"] == mock_account.current_tenant_id
        assert call_args["app_id"] == "test-app"
        assert call_args["triggered_from"] == WorkflowRunTriggeredFrom.APP_RUN
        assert call_args["creator_user_id"] == mock_account.id

        # Verify no task tracking occurs (no _pending_saves attribute)
        assert not hasattr(repo, "_pending_saves")

    @patch("core.repositories.celery_workflow_execution_repository.save_workflow_execution_task")
    def test_save_handles_celery_failure(
        self, mock_task, mock_session_factory, mock_account, sample_workflow_execution
    ):
        """Test that save operation handles Celery task failures."""
        mock_task.delay.side_effect = Exception("Celery is down")

        repo = CeleryWorkflowExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        with pytest.raises(Exception, match="Celery is down"):
            repo.save(sample_workflow_execution)

    @patch("core.repositories.celery_workflow_execution_repository.save_workflow_execution_task")
    def test_save_operation_fire_and_forget(
        self, mock_task, mock_session_factory, mock_account, sample_workflow_execution
    ):
        """Test that save operation works in fire-and-forget mode."""
        repo = CeleryWorkflowExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        # Test that save doesn't block or maintain state
        repo.save(sample_workflow_execution)

        # Verify no pending saves are tracked (no _pending_saves attribute)
        assert not hasattr(repo, "_pending_saves")

    @patch("core.repositories.celery_workflow_execution_repository.save_workflow_execution_task")
    def test_multiple_save_operations(self, mock_task, mock_session_factory, mock_account):
        """Test multiple save operations work correctly."""
        repo = CeleryWorkflowExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        # Create multiple executions
        exec1 = WorkflowExecution.new(
            id_=str(uuid4()),
            workflow_id=str(uuid4()),
            workflow_type=WorkflowType.WORKFLOW,
            workflow_version="1.0",
            graph={"nodes": [], "edges": []},
            inputs={"input1": "value1"},
            started_at=naive_utc_now(),
        )
        exec2 = WorkflowExecution.new(
            id_=str(uuid4()),
            workflow_id=str(uuid4()),
            workflow_type=WorkflowType.WORKFLOW,
            workflow_version="1.0",
            graph={"nodes": [], "edges": []},
            inputs={"input2": "value2"},
            started_at=naive_utc_now(),
        )

        # Save both executions
        repo.save(exec1)
        repo.save(exec2)

        # Should work without issues and not maintain state (no _pending_saves attribute)
        assert not hasattr(repo, "_pending_saves")

    @patch("core.repositories.celery_workflow_execution_repository.save_workflow_execution_task")
    def test_save_with_different_user_types(self, mock_task, mock_session_factory, mock_end_user):
        """Test save operation with different user types."""
        repo = CeleryWorkflowExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_end_user,
            app_id="test-app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        execution = WorkflowExecution.new(
            id_=str(uuid4()),
            workflow_id=str(uuid4()),
            workflow_type=WorkflowType.WORKFLOW,
            workflow_version="1.0",
            graph={"nodes": [], "edges": []},
            inputs={"input1": "value1"},
            started_at=naive_utc_now(),
        )

        repo.save(execution)

        # Verify task was called with EndUser context
        mock_task.delay.assert_called_once()
        call_args = mock_task.delay.call_args[1]
        assert call_args["tenant_id"] == mock_end_user.tenant_id
        assert call_args["creator_user_id"] == mock_end_user.id
