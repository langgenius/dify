"""
Unit tests for CeleryWorkflowNodeExecutionRepository.

These tests verify the Celery-based asynchronous storage functionality
for workflow node execution data.
"""

from unittest.mock import Mock, patch
from uuid import uuid4

import pytest

from core.repositories.celery_workflow_node_execution_repository import CeleryWorkflowNodeExecutionRepository
from core.workflow.entities.workflow_node_execution import (
    WorkflowNodeExecution,
    WorkflowNodeExecutionStatus,
)
from core.workflow.enums import NodeType
from core.workflow.repositories.workflow_node_execution_repository import OrderConfig
from libs.datetime_utils import naive_utc_now
from models import Account, EndUser
from models.workflow import WorkflowNodeExecutionTriggeredFrom


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
def sample_workflow_node_execution():
    """Sample WorkflowNodeExecution for testing."""
    return WorkflowNodeExecution(
        id=str(uuid4()),
        node_execution_id=str(uuid4()),
        workflow_id=str(uuid4()),
        workflow_execution_id=str(uuid4()),
        index=1,
        node_id="test_node",
        node_type=NodeType.START,
        title="Test Node",
        inputs={"input1": "value1"},
        status=WorkflowNodeExecutionStatus.RUNNING,
        created_at=naive_utc_now(),
    )


class TestCeleryWorkflowNodeExecutionRepository:
    """Test cases for CeleryWorkflowNodeExecutionRepository."""

    def test_init_with_sessionmaker(self, mock_session_factory, mock_account):
        """Test repository initialization with sessionmaker."""
        app_id = "test-app-id"
        triggered_from = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN

        repo = CeleryWorkflowNodeExecutionRepository(
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

    def test_init_with_cache_initialized(self, mock_session_factory, mock_account):
        """Test repository initialization with cache properly initialized."""
        repo = CeleryWorkflowNodeExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
        )

        assert repo._execution_cache == {}
        assert repo._workflow_execution_mapping == {}

    def test_init_with_end_user(self, mock_session_factory, mock_end_user):
        """Test repository initialization with EndUser."""
        repo = CeleryWorkflowNodeExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_end_user,
            app_id="test-app",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

        assert repo._tenant_id == mock_end_user.tenant_id

    def test_init_without_tenant_id_raises_error(self, mock_session_factory):
        """Test that initialization fails without tenant_id."""
        # Create a mock Account with no tenant_id
        user = Mock(spec=Account)
        user.current_tenant_id = None
        user.id = str(uuid4())

        with pytest.raises(ValueError, match="User must have a tenant_id"):
            CeleryWorkflowNodeExecutionRepository(
                session_factory=mock_session_factory,
                user=user,
                app_id="test-app",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )

    @patch("core.repositories.celery_workflow_node_execution_repository.save_workflow_node_execution_task")
    def test_save_caches_and_queues_celery_task(
        self, mock_task, mock_session_factory, mock_account, sample_workflow_node_execution
    ):
        """Test that save operation caches execution and queues a Celery task."""
        repo = CeleryWorkflowNodeExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

        repo.save(sample_workflow_node_execution)

        # Verify Celery task was queued with correct parameters
        mock_task.delay.assert_called_once()
        call_args = mock_task.delay.call_args[1]

        assert call_args["execution_data"] == sample_workflow_node_execution.model_dump()
        assert call_args["tenant_id"] == mock_account.current_tenant_id
        assert call_args["app_id"] == "test-app"
        assert call_args["triggered_from"] == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
        assert call_args["creator_user_id"] == mock_account.id

        # Verify execution is cached
        assert sample_workflow_node_execution.id in repo._execution_cache
        assert repo._execution_cache[sample_workflow_node_execution.id] == sample_workflow_node_execution

        # Verify workflow execution mapping is updated
        assert sample_workflow_node_execution.workflow_execution_id in repo._workflow_execution_mapping
        assert (
            sample_workflow_node_execution.id
            in repo._workflow_execution_mapping[sample_workflow_node_execution.workflow_execution_id]
        )

    @patch("core.repositories.celery_workflow_node_execution_repository.save_workflow_node_execution_task")
    def test_save_handles_celery_failure(
        self, mock_task, mock_session_factory, mock_account, sample_workflow_node_execution
    ):
        """Test that save operation handles Celery task failures."""
        mock_task.delay.side_effect = Exception("Celery is down")

        repo = CeleryWorkflowNodeExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

        with pytest.raises(Exception, match="Celery is down"):
            repo.save(sample_workflow_node_execution)

    @patch("core.repositories.celery_workflow_node_execution_repository.save_workflow_node_execution_task")
    def test_get_by_workflow_run_from_cache(
        self, mock_task, mock_session_factory, mock_account, sample_workflow_node_execution
    ):
        """Test that get_by_workflow_run retrieves executions from cache."""
        repo = CeleryWorkflowNodeExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

        # Save execution to cache first
        repo.save(sample_workflow_node_execution)

        workflow_run_id = sample_workflow_node_execution.workflow_execution_id
        order_config = OrderConfig(order_by=["index"], order_direction="asc")

        result = repo.get_by_workflow_run(workflow_run_id, order_config)

        # Verify results were retrieved from cache
        assert len(result) == 1
        assert result[0].id == sample_workflow_node_execution.id
        assert result[0] is sample_workflow_node_execution

    def test_get_by_workflow_run_without_order_config(self, mock_session_factory, mock_account):
        """Test get_by_workflow_run without order configuration."""
        repo = CeleryWorkflowNodeExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

        result = repo.get_by_workflow_run("workflow-run-id")

        # Should return empty list since nothing in cache
        assert len(result) == 0

    @patch("core.repositories.celery_workflow_node_execution_repository.save_workflow_node_execution_task")
    def test_cache_operations(self, mock_task, mock_session_factory, mock_account, sample_workflow_node_execution):
        """Test cache operations work correctly."""
        repo = CeleryWorkflowNodeExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

        # Test saving to cache
        repo.save(sample_workflow_node_execution)

        # Verify cache contains the execution
        assert sample_workflow_node_execution.id in repo._execution_cache

        # Test retrieving from cache
        result = repo.get_by_workflow_run(sample_workflow_node_execution.workflow_execution_id)
        assert len(result) == 1
        assert result[0].id == sample_workflow_node_execution.id

    @patch("core.repositories.celery_workflow_node_execution_repository.save_workflow_node_execution_task")
    def test_multiple_executions_same_workflow(self, mock_task, mock_session_factory, mock_account):
        """Test multiple executions for the same workflow."""
        repo = CeleryWorkflowNodeExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

        # Create multiple executions for the same workflow
        workflow_run_id = str(uuid4())
        exec1 = WorkflowNodeExecution(
            id=str(uuid4()),
            node_execution_id=str(uuid4()),
            workflow_id=str(uuid4()),
            workflow_execution_id=workflow_run_id,
            index=1,
            node_id="node1",
            node_type=NodeType.START,
            title="Node 1",
            inputs={"input1": "value1"},
            status=WorkflowNodeExecutionStatus.RUNNING,
            created_at=naive_utc_now(),
        )
        exec2 = WorkflowNodeExecution(
            id=str(uuid4()),
            node_execution_id=str(uuid4()),
            workflow_id=str(uuid4()),
            workflow_execution_id=workflow_run_id,
            index=2,
            node_id="node2",
            node_type=NodeType.LLM,
            title="Node 2",
            inputs={"input2": "value2"},
            status=WorkflowNodeExecutionStatus.RUNNING,
            created_at=naive_utc_now(),
        )

        # Save both executions
        repo.save(exec1)
        repo.save(exec2)

        # Verify both are cached and mapped
        assert len(repo._execution_cache) == 2
        assert len(repo._workflow_execution_mapping[workflow_run_id]) == 2

        # Test retrieval
        result = repo.get_by_workflow_run(workflow_run_id)
        assert len(result) == 2

    @patch("core.repositories.celery_workflow_node_execution_repository.save_workflow_node_execution_task")
    def test_ordering_functionality(self, mock_task, mock_session_factory, mock_account):
        """Test ordering functionality works correctly."""
        repo = CeleryWorkflowNodeExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test-app",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

        # Create executions with different indices
        workflow_run_id = str(uuid4())
        exec1 = WorkflowNodeExecution(
            id=str(uuid4()),
            node_execution_id=str(uuid4()),
            workflow_id=str(uuid4()),
            workflow_execution_id=workflow_run_id,
            index=2,
            node_id="node2",
            node_type=NodeType.START,
            title="Node 2",
            inputs={},
            status=WorkflowNodeExecutionStatus.RUNNING,
            created_at=naive_utc_now(),
        )
        exec2 = WorkflowNodeExecution(
            id=str(uuid4()),
            node_execution_id=str(uuid4()),
            workflow_id=str(uuid4()),
            workflow_execution_id=workflow_run_id,
            index=1,
            node_id="node1",
            node_type=NodeType.LLM,
            title="Node 1",
            inputs={},
            status=WorkflowNodeExecutionStatus.RUNNING,
            created_at=naive_utc_now(),
        )

        # Save in random order
        repo.save(exec1)
        repo.save(exec2)

        # Test ascending order
        order_config = OrderConfig(order_by=["index"], order_direction="asc")
        result = repo.get_by_workflow_run(workflow_run_id, order_config)
        assert len(result) == 2
        assert result[0].index == 1
        assert result[1].index == 2

        # Test descending order
        order_config = OrderConfig(order_by=["index"], order_direction="desc")
        result = repo.get_by_workflow_run(workflow_run_id, order_config)
        assert len(result) == 2
        assert result[0].index == 2
        assert result[1].index == 1
