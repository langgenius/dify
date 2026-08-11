"""
Unit tests for CeleryWorkflowExecutionRepository.

These tests verify the Celery-based asynchronous storage functionality
for workflow execution data.
"""

from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.celery_workflow_execution_repository import CeleryWorkflowExecutionRepository
from graphon.entities import WorkflowExecution
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from libs.datetime_utils import naive_utc_now
from models import Account, EndUser, Tenant, WorkflowRun
from models.enums import WorkflowRunTriggeredFrom

RESOURCE_TENANT_ID = "resource-tenant-id"


@pytest.fixture
def mock_account():
    """Mock Account user."""
    account = Account(name="Test Account", email="test@example.com")
    account.id = str(uuid4())
    account._current_tenant = Tenant(name="Test Tenant")
    account._current_tenant.id = str(uuid4())
    return account


@pytest.fixture
def mock_end_user():
    """Mock EndUser."""
    user = EndUser(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
    )
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

    def test_init_with_sessionmaker(self, sqlite_session_factory: sessionmaker[Session], mock_account):
        """Test repository initialization with sessionmaker."""
        app_id = "test-app-id"
        triggered_from = WorkflowRunTriggeredFrom.APP_RUN

        repo = CeleryWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id=RESOURCE_TENANT_ID,
            user=mock_account,
            app_id=app_id,
            triggered_from=triggered_from,
        )

        assert repo._tenant_id == RESOURCE_TENANT_ID
        assert repo._app_id == app_id
        assert repo._triggered_from == triggered_from
        assert repo._creator_user_id == mock_account.id
        assert repo._creator_user_role is not None

    def test_init_basic_functionality(self, sqlite_session_factory: sessionmaker[Session], mock_account):
        """Test repository initialization basic functionality."""
        repo = CeleryWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id=RESOURCE_TENANT_ID,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        )

        # Verify basic initialization
        assert repo._tenant_id == RESOURCE_TENANT_ID
        assert repo._app_id == "test-app"
        assert repo._triggered_from == WorkflowRunTriggeredFrom.DEBUGGING

    def test_init_with_end_user(self, sqlite_session_factory: sessionmaker[Session], mock_end_user):
        """Test repository initialization with EndUser."""
        repo = CeleryWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id=RESOURCE_TENANT_ID,
            user=mock_end_user,
            app_id="test-app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        assert repo._tenant_id == RESOURCE_TENANT_ID

    def test_init_without_tenant_id_raises_error(self, sqlite_session_factory: sessionmaker[Session]):
        """Test that initialization fails without tenant_id."""
        # Create an Account with no tenant_id.
        user = Account(name="Test Account", email="test@example.com")
        user.id = str(uuid4())

        with pytest.raises(ValueError, match="tenant_id is required"):
            CeleryWorkflowExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id="",
                user=user,
                app_id="test-app",
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            )

    def test_init_uses_resource_tenant_when_account_has_no_current_tenant(
        self, sqlite_session_factory: sessionmaker[Session]
    ):
        user = Account(name="Test Account", email="test@example.com")
        user.id = str(uuid4())

        repo = CeleryWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id=RESOURCE_TENANT_ID,
            user=user,
            app_id="test-app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        assert repo._tenant_id == RESOURCE_TENANT_ID
        assert repo._creator_user_id == user.id

    @patch("core.repositories.celery_workflow_execution_repository.save_workflow_execution_task")
    def test_initial_save_creates_workflow_run_synchronously(
        self,
        mock_task,
        sqlite_session_factory: sessionmaker[Session],
        sqlite_session: Session,
        mock_account,
        sample_workflow_execution,
    ):
        """Test that initial save creates WorkflowRun before returning."""
        repo = CeleryWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id=RESOURCE_TENANT_ID,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        repo.save(sample_workflow_execution)

        mock_task.delay.assert_not_called()
        persisted_run = sqlite_session.get(WorkflowRun, sample_workflow_execution.id_)
        assert persisted_run is not None
        assert persisted_run.tenant_id == RESOURCE_TENANT_ID
        assert persisted_run.status == WorkflowExecutionStatus.RUNNING

    @patch("core.repositories.celery_workflow_execution_repository.save_workflow_execution_task")
    def test_subsequent_save_queues_celery_task(
        self,
        mock_task,
        sqlite_session_factory: sessionmaker[Session],
        mock_account,
        sample_workflow_execution,
    ):
        """Test that updates for an existing WorkflowRun are saved asynchronously."""
        repo = CeleryWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id=RESOURCE_TENANT_ID,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        repo.save(sample_workflow_execution)
        sample_workflow_execution.status = WorkflowExecutionStatus.PAUSED
        repo.save(sample_workflow_execution)

        mock_task.delay.assert_called_once()
        call_args = mock_task.delay.call_args[1]

        assert call_args["execution_data"] == sample_workflow_execution.model_dump()
        assert call_args["tenant_id"] == RESOURCE_TENANT_ID
        assert call_args["app_id"] == "test-app"
        assert call_args["triggered_from"] == WorkflowRunTriggeredFrom.APP_RUN.value
        assert call_args["creator_user_id"] == mock_account.id

        # Verify no task tracking occurs (no _pending_saves attribute)
        assert not hasattr(repo, "_pending_saves")

    @patch("core.repositories.celery_workflow_execution_repository.save_workflow_execution_task")
    def test_save_handles_celery_failure(
        self,
        mock_task,
        sqlite_session_factory: sessionmaker[Session],
        mock_account,
        sample_workflow_execution,
    ):
        """Test that update save operation handles Celery task failures."""
        mock_task.delay.side_effect = Exception("Celery is down")

        repo = CeleryWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id=RESOURCE_TENANT_ID,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        repo.save(sample_workflow_execution)

        with pytest.raises(Exception, match="Celery is down"):
            repo.save(sample_workflow_execution)

    @patch("core.repositories.celery_workflow_execution_repository.save_workflow_execution_task")
    def test_save_operation_fire_and_forget(
        self,
        mock_task,
        sqlite_session_factory: sessionmaker[Session],
        mock_account,
        sample_workflow_execution,
    ):
        """Test that update save operation works in fire-and-forget mode."""
        repo = CeleryWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id=RESOURCE_TENANT_ID,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        repo.save(sample_workflow_execution)
        repo.save(sample_workflow_execution)

        # Verify no pending saves are tracked (no _pending_saves attribute)
        assert not hasattr(repo, "_pending_saves")
        mock_task.delay.assert_called_once()

    @patch("core.repositories.celery_workflow_execution_repository.save_workflow_execution_task")
    def test_multiple_save_operations(self, mock_task, sqlite_session_factory: sessionmaker[Session], mock_account):
        """Test multiple save operations work correctly."""
        repo = CeleryWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id=RESOURCE_TENANT_ID,
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
        mock_task.delay.assert_not_called()

    @patch("core.repositories.celery_workflow_execution_repository.save_workflow_execution_task")
    def test_save_with_different_user_types(
        self,
        mock_task,
        sqlite_session_factory: sessionmaker[Session],
        sqlite_session: Session,
        mock_end_user,
    ):
        """Test save operation with different user types."""
        repo = CeleryWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id=mock_end_user.tenant_id,
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

        mock_task.delay.assert_not_called()
        persisted_run = sqlite_session.get(WorkflowRun, execution.id_)
        assert persisted_run is not None
        assert persisted_run.tenant_id == mock_end_user.tenant_id
        assert persisted_run.created_by == mock_end_user.id

    def test_save_rejects_execution_owned_by_another_tenant(
        self,
        sqlite_session_factory: sessionmaker[Session],
        mock_account,
        sample_workflow_execution,
    ):
        other_account = Account(name="Other Account", email="other@example.com")
        other_account.id = str(uuid4())
        other_tenant_id = str(uuid4())
        other_repo = CeleryWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id=other_tenant_id,
            user=other_account,
            app_id="test-app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )
        other_repo.save(sample_workflow_execution)

        repo = CeleryWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id=RESOURCE_TENANT_ID,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        with pytest.raises(ValueError, match="Unauthorized access to workflow run"):
            repo.save(sample_workflow_execution)
