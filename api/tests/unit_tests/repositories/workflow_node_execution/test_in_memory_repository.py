"""
Unit tests for the InMemory implementation of WorkflowNodeExecutionRepository.
"""

from datetime import datetime
from decimal import Decimal
from unittest.mock import MagicMock

import pytest

from core.repositories.in_memory_workflow_node_execution_repository import InMemoryWorkflowNodeExecutionRepository
from core.workflow.entities.workflow_node_execution import (
    WorkflowNodeExecution,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.nodes.enums import NodeType
from core.workflow.repositories.workflow_node_execution_repository import OrderConfig
from models import Account, CreatorUserRole, EndUser, Tenant, WorkflowNodeExecutionTriggeredFrom


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
    return InMemoryWorkflowNodeExecutionRepository(
        user=mock_account_user,
        app_id=app_id,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )


@pytest.fixture
def end_user_repository(mock_end_user):
    """Create a repository instance with end user for testing."""
    app_id = "test-app"
    return InMemoryWorkflowNodeExecutionRepository(
        user=mock_end_user,
        app_id=app_id,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
    )


@pytest.fixture
def sample_node_execution():
    """Create a sample WorkflowNodeExecution for testing."""
    return WorkflowNodeExecution(
        id="test-id",
        workflow_id="test-workflow-id",
        node_execution_id="test-node-execution-id",
        workflow_execution_id="test-workflow-run-id",
        index=1,
        predecessor_node_id="test-predecessor-id",
        node_id="test-node-id",
        node_type=NodeType.START,
        title="Test Node",
        inputs={"input_key": "input_value"},
        process_data={"process_key": "process_value"},
        outputs={"output_key": "output_value"},
        status=WorkflowNodeExecutionStatus.RUNNING,
        error=None,
        elapsed_time=1.5,
        metadata={
            WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 100,
            WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: Decimal("0.0"),
        },
        created_at=datetime.now(),
        finished_at=None,
    )


def test_init_with_account_user(mock_account_user):
    """Test initialization with Account user."""
    app_id = "test-app"
    repo = InMemoryWorkflowNodeExecutionRepository(
        user=mock_account_user,
        app_id=app_id,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )

    assert repo._tenant_id == "test-tenant"
    assert repo._app_id == app_id
    assert repo._triggered_from == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
    assert repo._creator_user_id == "test-user-id"
    assert repo._creator_user_role == CreatorUserRole.ACCOUNT


def test_init_with_end_user(mock_end_user):
    """Test initialization with EndUser."""
    app_id = "test-app"
    repo = InMemoryWorkflowNodeExecutionRepository(
        user=mock_end_user,
        app_id=app_id,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
    )

    assert repo._tenant_id == "test-tenant"
    assert repo._app_id == app_id
    assert repo._triggered_from == WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP
    assert repo._creator_user_id == "test-end-user-id"
    assert repo._creator_user_role == CreatorUserRole.END_USER


def test_init_without_tenant_id():
    """Test initialization without tenant_id raises ValueError."""
    user = Account()
    user.id = "test-user-id"

    # Mock the current_tenant_id property to return None
    user._current_tenant = None

    with pytest.raises(ValueError, match="User must have a tenant_id or current_tenant_id"):
        InMemoryWorkflowNodeExecutionRepository(
            user=user,
            app_id="test-app",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )


def test_save(account_repository, sample_node_execution):
    """Test save method."""
    # Call save method
    account_repository.save(sample_node_execution)

    # Verify the execution was saved in the internal storage
    assert sample_node_execution.node_execution_id in account_repository._executions
    assert account_repository._executions[sample_node_execution.node_execution_id] is sample_node_execution

    # Verify workflow run index was updated
    assert sample_node_execution.workflow_execution_id is not None
    assert sample_node_execution.workflow_execution_id in account_repository._workflow_run_index
    assert (
        sample_node_execution.node_execution_id
        in account_repository._workflow_run_index[sample_node_execution.workflow_execution_id]
    )


def test_get_by_node_execution_id(account_repository, sample_node_execution):
    """Test get_by_node_execution_id method."""
    # Save the execution first
    account_repository.save(sample_node_execution)

    # Retrieve the execution
    retrieved = account_repository.get_by_node_execution_id(sample_node_execution.node_execution_id)

    # Verify we got the correct execution
    assert retrieved is sample_node_execution


def test_get_by_node_execution_id_not_found(account_repository):
    """Test get_by_node_execution_id with a non-existent ID."""
    retrieved = account_repository.get_by_node_execution_id("non-existent-id")

    # Verify we got None
    assert retrieved is None


def test_get_by_workflow_run(account_repository, sample_node_execution):
    """Test get_by_workflow_run method."""
    # Save the execution first
    account_repository.save(sample_node_execution)

    # Create and save another execution in the same workflow run
    another_execution = WorkflowNodeExecution(
        id="test-id-2",
        workflow_id="test-workflow-id",
        node_execution_id="test-node-execution-id-2",
        workflow_execution_id=sample_node_execution.workflow_execution_id,
        index=2,
        predecessor_node_id=sample_node_execution.node_id,
        node_id="test-node-id-2",
        node_type=NodeType.LLM,
        title="Test Node 2",
        inputs={},  # Empty dict for inputs
        process_data={},  # Empty dict for process_data
        outputs={},  # Empty dict for outputs
        status=WorkflowNodeExecutionStatus.RUNNING,
        error=None,
        elapsed_time=0.0,
        metadata={},  # Empty dict for metadata
        created_at=datetime.now(),
        finished_at=None,
    )
    account_repository.save(another_execution)

    # Retrieve the executions
    executions = account_repository.get_by_workflow_run(sample_node_execution.workflow_execution_id)

    # Verify we got both executions
    assert len(executions) == 2
    assert sample_node_execution in executions
    assert another_execution in executions


def test_get_by_workflow_run_with_ordering(account_repository):
    """Test get_by_workflow_run method with ordering."""
    # Create and save executions with different creation times and indices
    workflow_execution_id = "test-workflow-run-id"

    # Create executions with different values to test sorting
    execution1 = WorkflowNodeExecution(
        id="test-id-1",
        workflow_id="test-workflow-id",
        node_execution_id="test-node-execution-id-1",
        workflow_execution_id=workflow_execution_id,
        index=1,
        node_id="test-node-id-1",
        node_type=NodeType.START,
        title="Test Node 1",
        inputs={},  # Empty dict for inputs
        process_data={},  # Empty dict for process_data
        outputs={},  # Empty dict for outputs
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        error=None,
        elapsed_time=1.0,
        metadata={},  # Empty dict for metadata
        created_at=datetime(2023, 1, 1, 10, 0, 0),
        finished_at=datetime(2023, 1, 1, 10, 0, 30),
    )

    execution2 = WorkflowNodeExecution(
        id="test-id-2",
        workflow_id="test-workflow-id",
        node_execution_id="test-node-execution-id-2",
        workflow_execution_id=workflow_execution_id,
        index=2,
        node_id="test-node-id-2",
        node_type=NodeType.LLM,
        title="Test Node 2",
        inputs={},  # Empty dict for inputs
        process_data={},  # Empty dict for process_data
        outputs={},  # Empty dict for outputs
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        error=None,
        elapsed_time=2.0,
        metadata={},  # Empty dict for metadata
        created_at=datetime(2023, 1, 1, 9, 0, 0),
        finished_at=datetime(2023, 1, 1, 9, 0, 30),
    )

    execution3 = WorkflowNodeExecution(
        id="test-id-3",
        workflow_id="test-workflow-id",
        node_execution_id="test-node-execution-id-3",
        workflow_execution_id=workflow_execution_id,
        index=3,
        node_id="test-node-id-3",
        node_type=NodeType.KNOWLEDGE_RETRIEVAL,
        title="Test Node 3",
        inputs={},  # Empty dict for inputs
        process_data={},  # Empty dict for process_data
        outputs={},  # Empty dict for outputs
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        error=None,
        elapsed_time=3.0,
        metadata={},  # Empty dict for metadata
        created_at=datetime(2023, 1, 1, 11, 0, 0),
        finished_at=datetime(2023, 1, 1, 11, 0, 30),
    )

    # Save in a different order
    account_repository.save(execution2)
    account_repository.save(execution1)
    account_repository.save(execution3)

    # Test ordering by index ascending
    order_config = OrderConfig(order_by=["index"], order_direction="asc")
    executions = account_repository.get_by_workflow_run(workflow_execution_id, order_config)

    # Verify order
    assert len(executions) == 3
    assert executions[0].index == 1
    assert executions[1].index == 2
    assert executions[2].index == 3

    # Test ordering by index descending
    order_config = OrderConfig(order_by=["index"], order_direction="desc")
    executions = account_repository.get_by_workflow_run(workflow_execution_id, order_config)

    # Verify order
    assert len(executions) == 3
    assert executions[0].index == 3
    assert executions[1].index == 2
    assert executions[2].index == 1

    # Test ordering by created_at
    order_config = OrderConfig(order_by=["created_at"], order_direction="asc")
    executions = account_repository.get_by_workflow_run(workflow_execution_id, order_config)

    # Verify order
    assert len(executions) == 3
    assert executions[0].node_execution_id == "test-node-execution-id-2"  # Earliest
    assert executions[1].node_execution_id == "test-node-execution-id-1"
    assert executions[2].node_execution_id == "test-node-execution-id-3"  # Latest

    # Test multi-field ordering
    order_config = OrderConfig(order_by=["node_type", "index"], order_direction="asc")
    executions = account_repository.get_by_workflow_run(workflow_execution_id, order_config)

    # Verify order - should be sorted by node_type first, then by index
    assert len(executions) == 3
    assert executions[0].node_type == NodeType.KNOWLEDGE_RETRIEVAL
    assert executions[1].node_type == NodeType.LLM
    assert executions[2].node_type == NodeType.START


def test_get_by_workflow_run_with_non_existent_attribute(account_repository, sample_node_execution):
    """Test get_by_workflow_run with ordering by a non-existent attribute."""
    # Save the execution
    account_repository.save(sample_node_execution)

    # Try to order by a non-existent attribute
    order_config = OrderConfig(order_by=["non_existent_field"], order_direction="asc")
    executions = account_repository.get_by_workflow_run(sample_node_execution.workflow_execution_id, order_config)

    # Should still return results without error
    assert len(executions) == 1
    assert executions[0] is sample_node_execution


def test_get_by_workflow_run_with_none_attribute_values(account_repository):
    """Test get_by_workflow_run with ordering by attributes that might be None."""
    workflow_execution_id = "test-workflow-run-id"

    # Create executions with some None values
    execution1 = WorkflowNodeExecution(
        id="test-id-1",
        workflow_id="test-workflow-id",
        node_execution_id="test-node-execution-id-1",
        workflow_execution_id=workflow_execution_id,
        index=1,
        node_id="test-node-id-1",
        predecessor_node_id=None,  # This is None
        node_type=NodeType.START,
        title="Test Node 1",
        inputs={},  # Empty dict for inputs
        process_data={},  # Empty dict for process_data
        outputs={},  # Empty dict for outputs
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        error=None,
        elapsed_time=1.0,
        metadata={},  # Empty dict for metadata
        created_at=datetime.now(),
        finished_at=None,
    )

    execution2 = WorkflowNodeExecution(
        id="test-id-2",
        workflow_id="test-workflow-id",
        node_execution_id="test-node-execution-id-2",
        workflow_execution_id=workflow_execution_id,
        index=2,
        node_id="test-node-id-2",
        predecessor_node_id="test-node-id-1",  # This has a value
        node_type=NodeType.LLM,
        title="Test Node 2",
        inputs={},  # Empty dict for inputs
        process_data={},  # Empty dict for process_data
        outputs={},  # Empty dict for outputs
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        error=None,
        elapsed_time=2.0,
        metadata={},  # Empty dict for metadata
        created_at=datetime.now(),
        finished_at=None,
    )

    # Save executions
    account_repository.save(execution1)
    account_repository.save(execution2)

    # Order by the field that has None values
    order_config = OrderConfig(order_by=["predecessor_node_id"], order_direction="asc")
    executions = account_repository.get_by_workflow_run(workflow_execution_id, order_config)

    # Should return results without error
    assert len(executions) == 2


def test_get_running_executions(account_repository):
    """Test get_running_executions method."""
    workflow_execution_id = "test-workflow-run-id"

    # Create a running execution
    running_execution = WorkflowNodeExecution(
        id="test-id-1",
        workflow_id="test-workflow-id",
        node_execution_id="test-node-execution-id-1",
        workflow_execution_id=workflow_execution_id,
        index=1,
        node_id="test-node-id-1",
        node_type=NodeType.START,
        title="Test Node 1",
        inputs={},  # Empty dict for inputs
        process_data={},  # Empty dict for process_data
        outputs={},  # Empty dict for outputs
        status=WorkflowNodeExecutionStatus.RUNNING,
        error=None,
        elapsed_time=1.0,
        metadata={},  # Empty dict for metadata
        created_at=datetime.now(),
        finished_at=None,
    )

    # Create a completed execution
    completed_execution = WorkflowNodeExecution(
        id="test-id-2",
        workflow_id="test-workflow-id",
        node_execution_id="test-node-execution-id-2",
        workflow_execution_id=workflow_execution_id,
        index=2,
        node_id="test-node-id-2",
        node_type=NodeType.LLM,
        title="Test Node 2",
        inputs={},  # Empty dict for inputs
        process_data={},  # Empty dict for process_data
        outputs={},  # Empty dict for outputs
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        error=None,
        elapsed_time=2.0,
        metadata={},  # Empty dict for metadata
        created_at=datetime.now(),
        finished_at=datetime.now(),
    )

    # Save both executions
    account_repository.save(running_execution)
    account_repository.save(completed_execution)

    # Get running executions
    running_executions = account_repository.get_running_executions(workflow_execution_id)

    # Verify only the running execution is returned
    assert len(running_executions) == 1
    assert running_executions[0] is running_execution


def test_clear(account_repository, sample_node_execution):
    """Test clear method."""
    # Save an execution
    account_repository.save(sample_node_execution)

    # Verify it was saved
    assert len(account_repository._executions) == 1
    assert len(account_repository._workflow_run_index) == 1

    # Clear the repository
    account_repository.clear()

    # Verify everything was cleared
    assert len(account_repository._executions) == 0
    assert len(account_repository._workflow_run_index) == 0


def test_matches_constraints(account_repository, sample_node_execution):
    """Test _matches_constraints method."""
    # For the in-memory implementation, _matches_constraints always returns True
    # This is because filtering is done at storage time
    assert account_repository._matches_constraints(sample_node_execution) is True
