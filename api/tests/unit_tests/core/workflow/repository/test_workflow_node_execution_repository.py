"""
Tests for the WorkflowNodeExecutionRepository.
"""

from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest

from core.workflow.entities.node_execution_entities import NodeExecution, NodeExecutionStatus
from core.workflow.repository.workflow_node_execution_repository import OrderConfig, WorkflowNodeExecutionRepository


@pytest.fixture
def repository():
    """Create a mock repository instance for testing."""
    repo = MagicMock(spec=WorkflowNodeExecutionRepository)
    repo._node_execution_cache = {}
    # Add update method to the mock
    repo.update = MagicMock()
    return repo


@pytest.fixture
def sample_node_execution():
    """Create a sample NodeExecution for testing."""
    now = datetime.now()
    return NodeExecution(
        id="test-id",
        node_execution_id="test-node-execution-id",
        workflow_id="test-workflow-id",
        workflow_run_id="test-workflow-run-id",
        index=1,
        predecessor_node_id="test-predecessor-node-id",
        node_id="test-node-id",
        node_type="test-node-type",
        title="Test Node",
        inputs={"input1": "value1"},
        process_data={"process1": "value1"},
        outputs={"output1": "value1"},
        status=NodeExecutionStatus.RUNNING,
        error=None,
        elapsed_time=0.0,
        metadata={"key1": "value1"},
        created_at=now,
        finished_at=None,
    )


def test_save_and_get_by_node_execution_id(repository, sample_node_execution):
    """Test saving a NodeExecution and retrieving it by node_execution_id."""
    # Setup mock behavior
    repository._node_execution_cache = {}
    repository.get_by_node_execution_id = MagicMock(return_value=sample_node_execution)

    # Save the node execution
    repository.save(sample_node_execution)

    # Retrieve the node execution
    retrieved = repository.get_by_node_execution_id(sample_node_execution.node_execution_id)

    # Verify the retrieved node execution
    assert retrieved is not None
    assert retrieved == sample_node_execution


def test_update(repository, sample_node_execution):
    """Test updating a NodeExecution."""
    # Setup mock behavior
    repository._node_execution_cache = {}
    updated_execution = sample_node_execution.model_copy(deep=True)
    updated_execution.status = NodeExecutionStatus.SUCCEEDED
    updated_execution.elapsed_time = 1.5
    updated_execution.finished_at = datetime.now()
    updated_execution.outputs = {"output1": "updated_value"}

    repository.get_by_node_execution_id = MagicMock(return_value=updated_execution)

    # Save the node execution
    repository.save(sample_node_execution)

    # Update the node execution
    sample_node_execution.status = NodeExecutionStatus.SUCCEEDED
    sample_node_execution.elapsed_time = 1.5
    sample_node_execution.finished_at = updated_execution.finished_at
    sample_node_execution.outputs = {"output1": "updated_value"}

    repository.update(sample_node_execution)

    # Retrieve the updated node execution
    retrieved = repository.get_by_node_execution_id(sample_node_execution.node_execution_id)

    # Verify the updated node execution
    assert retrieved is not None
    assert retrieved.status == NodeExecutionStatus.SUCCEEDED
    assert retrieved.elapsed_time == 1.5
    assert retrieved.finished_at is not None
    assert retrieved.outputs == {"output1": "updated_value"}


def test_get_by_workflow_run(repository, sample_node_execution):
    """Test retrieving NodeExecutions by workflow_run_id."""
    # Create another node execution with the same workflow_run_id
    now = datetime.now()
    another_execution = NodeExecution(
        id="test-id-2",
        node_execution_id="test-node-execution-id-2",
        workflow_id=sample_node_execution.workflow_id,
        workflow_run_id=sample_node_execution.workflow_run_id,
        index=2,
        predecessor_node_id=sample_node_execution.node_id,
        node_id="test-node-id-2",
        node_type="test-node-type-2",
        title="Test Node 2",
        inputs={"input2": "value2"},
        process_data={"process2": "value2"},
        outputs={"output2": "value2"},
        status=NodeExecutionStatus.RUNNING,
        error=None,
        elapsed_time=0.0,
        metadata={"key2": "value2"},
        created_at=now + timedelta(seconds=1),
        finished_at=None,
    )

    # Setup mock behavior
    repository.get_by_workflow_run = MagicMock(return_value=[sample_node_execution, another_execution])

    # Retrieve node executions by workflow_run_id
    executions = repository.get_by_workflow_run(sample_node_execution.workflow_run_id)

    # Verify the retrieved node executions
    assert len(executions) == 2
    assert any(e.node_execution_id == sample_node_execution.node_execution_id for e in executions)
    assert any(e.node_execution_id == another_execution.node_execution_id for e in executions)

    # Setup mock behavior for ordered executions
    repository.get_by_workflow_run = MagicMock(return_value=[sample_node_execution, another_execution])

    # Test with ordering
    order_config = OrderConfig(order_by=["index"], order_direction="asc")
    ordered_executions = repository.get_by_workflow_run(sample_node_execution.workflow_run_id, order_config)
    assert len(ordered_executions) == 2


def test_get_running_executions(repository, sample_node_execution):
    """Test retrieving running NodeExecutions."""
    # Setup mock behavior
    repository.get_running_executions = MagicMock(return_value=[sample_node_execution])

    # Retrieve running node executions
    running_executions = repository.get_running_executions(sample_node_execution.workflow_run_id)

    # Verify the retrieved node executions
    assert len(running_executions) == 1
    assert running_executions[0].node_execution_id == sample_node_execution.node_execution_id
    assert running_executions[0].status == NodeExecutionStatus.RUNNING


def test_clear(repository, sample_node_execution):
    """Test clearing all NodeExecutions."""
    # Setup mock behavior
    repository._node_execution_cache = {sample_node_execution.node_execution_id: sample_node_execution}
    repository.get_by_node_execution_id = MagicMock(side_effect=[sample_node_execution, None])

    # Verify the node execution exists
    assert repository.get_by_node_execution_id(sample_node_execution.node_execution_id) is not None

    # Clear all node executions
    repository.clear()

    # Verify the node execution no longer exists
    assert repository.get_by_node_execution_id(sample_node_execution.node_execution_id) is None
