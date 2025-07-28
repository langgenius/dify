"""
Unit tests for CeleryWorkflowExecutionRepository.

These tests verify the Celery-based asynchronous storage functionality
for workflow execution data.
"""

from datetime import UTC, datetime
from unittest.mock import Mock, patch
from uuid import uuid4

import pytest
from celery.result import AsyncResult

from core.repositories.celery_workflow_execution_repository import CeleryWorkflowExecutionRepository
from core.workflow.entities.workflow_execution import WorkflowExecution, WorkflowType
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
        started_at=datetime.now(UTC).replace(tzinfo=None),
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
        assert repo._async_timeout == 30  # default timeout

    def test_init_with_custom_timeout(self, mock_session_factory, mock_account):
        """Test repository initialization with custom timeout."""
        custom_timeout = 60

        repo = CeleryWorkflowExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            async_timeout=custom_timeout,
        )

        assert repo._async_timeout == custom_timeout

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
        """Test that save operation queues a Celery task."""
        mock_result = Mock(spec=AsyncResult)
        mock_task.delay.return_value = mock_result

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
        assert call_args["triggered_from"] == WorkflowRunTriggeredFrom.APP_RUN.value
        assert call_args["creator_user_id"] == mock_account.id

        # Verify task result is stored for tracking
        assert sample_workflow_execution.id_ in repo._pending_saves
        assert repo._pending_saves[sample_workflow_execution.id_] == mock_result

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

    def test_wait_for_pending_saves(self, mock_session_factory, mock_account, sample_workflow_execution):
        """Test waiting for all pending save operations."""
        repo = CeleryWorkflowExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        # Add some mock pending saves
        mock_result1 = Mock(spec=AsyncResult)
        mock_result1.ready.return_value = False
        mock_result2 = Mock(spec=AsyncResult)
        mock_result2.ready.return_value = True

        repo._pending_saves["exec1"] = mock_result1
        repo._pending_saves["exec2"] = mock_result2

        repo.wait_for_pending_saves(timeout=10)

        # Verify that non-ready task was waited for
        mock_result1.get.assert_called_once_with(timeout=10)

        # Verify pending saves were cleared
        assert len(repo._pending_saves) == 0

    def test_get_pending_save_count(self, mock_session_factory, mock_account):
        """Test getting the count of pending save operations."""
        repo = CeleryWorkflowExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        # Add some mock pending saves
        mock_result1 = Mock(spec=AsyncResult)
        mock_result1.ready.return_value = False
        mock_result2 = Mock(spec=AsyncResult)
        mock_result2.ready.return_value = True

        repo._pending_saves["exec1"] = mock_result1
        repo._pending_saves["exec2"] = mock_result2

        count = repo.get_pending_save_count()

        # Should clean up completed tasks and return count of remaining
        assert count == 1
        assert "exec1" in repo._pending_saves
        assert "exec2" not in repo._pending_saves

    def test_clear_pending_saves(self, mock_session_factory, mock_account):
        """Test clearing all pending save operations."""
        repo = CeleryWorkflowExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        # Add some mock pending saves
        repo._pending_saves["exec1"] = Mock(spec=AsyncResult)
        repo._pending_saves["exec2"] = Mock(spec=AsyncResult)

        repo.clear_pending_saves()

        assert len(repo._pending_saves) == 0
