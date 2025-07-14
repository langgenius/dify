"""
Unit tests for the InMemory implementation of WorkflowExecutionRepository.
"""

from datetime import datetime
from unittest.mock import MagicMock

import pytest

from core.repositories.in_memory_workflow_execution_repository import InMemoryWorkflowExecutionRepository
from core.workflow.entities.workflow_execution import (
    WorkflowExecution,
    WorkflowExecutionStatus,
    WorkflowType,
)
from models import Account, CreatorUserRole, EndUser, Tenant
from models.enums import WorkflowRunTriggeredFrom


@pytest.fixture
def mock_account_user():
    """Create an account user instance for testing."""
    user = Account()
    user.id = "test-user-id"

    tenant = Tenant()
    tenant.id = "test-tenant"
    tenant.name = "Test Workspace"
    user._current_tenant = MagicMock()
    user._current_tenant.id = "test-tenant"

    return user


@pytest.fixture
def mock_end_user():
    """Create an end user instance for testing."""
    user = EndUser()
    user.id = "test-end-user-id"
    user.tenant_id = "test-tenant"

    return user


@pytest.fixture
def account_repository(mock_account_user):
    """Create a repository instance with account user for testing."""
    app_id = "test-app"
    return InMemoryWorkflowExecutionRepository(
        user=mock_account_user,
        app_id=app_id,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
    )


@pytest.fixture
def end_user_repository(mock_end_user):
    """Create a repository instance with end user for testing."""
    app_id = "test-app"
    return InMemoryWorkflowExecutionRepository(
        user=mock_end_user,
        app_id=app_id,
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
    )


@pytest.fixture
def sample_workflow_execution():
    """Create a sample WorkflowExecution for testing."""
    return WorkflowExecution(
        id_="test-execution-id",
        workflow_id="test-workflow-id",
        workflow_type=WorkflowType.WORKFLOW,
        workflow_version="1",
        graph={"nodes": [], "edges": []},
        inputs={"input_key": "input_value"},
        outputs={"output_key": "output_value"},
        status=WorkflowExecutionStatus.RUNNING,
        error_message="",
        total_tokens=100,
        total_steps=5,
        exceptions_count=0,
        started_at=datetime.now(),
        finished_at=None,
    )


def test_init_with_account_user(mock_account_user):
    """Test initialization with Account user."""
    app_id = "test-app"
    repo = InMemoryWorkflowExecutionRepository(
        user=mock_account_user,
        app_id=app_id,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
    )

    assert repo._tenant_id == "test-tenant"
    assert repo._app_id == app_id
    assert repo._triggered_from == WorkflowRunTriggeredFrom.APP_RUN
    assert repo._creator_user_id == "test-user-id"
    assert repo._creator_user_role == CreatorUserRole.ACCOUNT


def test_init_with_end_user(mock_end_user):
    """Test initialization with EndUser."""
    app_id = "test-app"
    repo = InMemoryWorkflowExecutionRepository(
        user=mock_end_user,
        app_id=app_id,
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
    )

    assert repo._tenant_id == "test-tenant"
    assert repo._app_id == app_id
    assert repo._triggered_from == WorkflowRunTriggeredFrom.DEBUGGING
    assert repo._creator_user_id == "test-end-user-id"
    assert repo._creator_user_role == CreatorUserRole.END_USER


def test_init_without_tenant_id():
    """Test initialization without tenant_id raises ValueError."""
    user = Account()
    user.id = "test-user-id"

    # Mock the current_tenant_id property to return None
    user._current_tenant = None

    with pytest.raises(ValueError, match="User must have a tenant_id or current_tenant_id"):
        InMemoryWorkflowExecutionRepository(
            user=user,
            app_id="test-app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )


def test_save(account_repository, sample_workflow_execution):
    """Test save method."""
    # Call save method
    account_repository.save(sample_workflow_execution)

    # Verify the execution was saved in the internal storage
    assert sample_workflow_execution.id_ in account_repository._executions
    assert account_repository._executions[sample_workflow_execution.id_] is sample_workflow_execution


def test_save_without_id(account_repository):
    """Test save method with missing id_."""
    execution = WorkflowExecution(
        id_="",  # Empty ID
        workflow_id="test-workflow-id",
        workflow_type=WorkflowType.WORKFLOW,
        workflow_version="1",
        graph={"nodes": [], "edges": []},
        inputs={},
        outputs={},
        status=WorkflowExecutionStatus.RUNNING,
        error_message="",
        total_tokens=0,
        total_steps=0,
        exceptions_count=0,
        started_at=datetime.now(),
        finished_at=None,
    )

    # Call save method
    account_repository.save(execution)

    # Verify nothing was saved
    assert len(account_repository._executions) == 0


def test_get(account_repository, sample_workflow_execution):
    """Test get method."""
    # Save the execution first
    account_repository.save(sample_workflow_execution)

    # Retrieve the execution
    retrieved = account_repository.get(sample_workflow_execution.id_)

    # Verify we got the correct execution
    assert retrieved is sample_workflow_execution


def test_get_not_found(account_repository):
    """Test get with a non-existent ID."""
    retrieved = account_repository.get("non-existent-id")

    # Verify we got None
    assert retrieved is None


def test_matches_constraints(account_repository, sample_workflow_execution):
    """Test _matches_constraints method."""
    # For the in-memory implementation, _matches_constraints always returns True
    # This is because filtering is done at storage time
    assert account_repository._matches_constraints(sample_workflow_execution) is True
