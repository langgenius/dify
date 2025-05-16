"""
Unit tests for the SQLAlchemy implementation of WorkflowNodeExecutionRepository.
"""

import json
from datetime import datetime
from unittest.mock import MagicMock, PropertyMock

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from core.repositories import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.entities.node_entities import NodeRunMetadataKey
from core.workflow.entities.node_execution_entities import NodeExecution, NodeExecutionStatus
from core.workflow.nodes.enums import NodeType
from core.workflow.repository.workflow_node_execution_repository import OrderConfig
from models.account import Account, Tenant
from models.workflow import WorkflowNodeExecution, WorkflowNodeExecutionStatus, WorkflowNodeExecutionTriggeredFrom


def configure_mock_execution(mock_execution):
    """Configure a mock execution with proper JSON serializable values."""
    # Configure inputs, outputs, process_data, and execution_metadata to return JSON serializable values
    type(mock_execution).inputs = PropertyMock(return_value='{"key": "value"}')
    type(mock_execution).outputs = PropertyMock(return_value='{"result": "success"}')
    type(mock_execution).process_data = PropertyMock(return_value='{"process": "data"}')
    type(mock_execution).execution_metadata = PropertyMock(return_value='{"metadata": "info"}')

    # Configure status and triggered_from to be valid enum values
    mock_execution.status = "running"
    mock_execution.triggered_from = "workflow-run"

    return mock_execution


@pytest.fixture
def session():
    """Create a mock SQLAlchemy session."""
    session = MagicMock(spec=Session)
    # Configure the session to be used as a context manager
    session.__enter__ = MagicMock(return_value=session)
    session.__exit__ = MagicMock(return_value=None)

    # Configure the session factory to return the session
    session_factory = MagicMock(spec=sessionmaker)
    session_factory.return_value = session
    return session, session_factory


@pytest.fixture
def mock_user():
    """Create a user instance for testing."""
    user = Account()
    user.id = "test-user-id"

    tenant = Tenant()
    tenant.id = "test-tenant"
    tenant.name = "Test Workspace"
    user._current_tenant = MagicMock()
    user._current_tenant.id = "test-tenant"

    return user


@pytest.fixture
def repository(session, mock_user):
    """Create a repository instance with test data."""
    _, session_factory = session
    app_id = "test-app"
    return SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=session_factory,
        user=mock_user,
        app_id=app_id,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )


def test_save(repository, session):
    """Test save method."""
    session_obj, _ = session
    # Create a mock execution
    execution = MagicMock(spec=WorkflowNodeExecution)
    execution.tenant_id = None
    execution.app_id = None
    execution.inputs = None
    execution.process_data = None
    execution.outputs = None
    execution.metadata = None

    # Mock the to_db_model method to return the execution itself
    # This simulates the behavior of setting tenant_id and app_id
    repository.to_db_model = MagicMock(return_value=execution)

    # Call save method
    repository.save(execution)

    # Assert to_db_model was called with the execution
    repository.to_db_model.assert_called_once_with(execution)

    # Assert session.merge was called (now using merge for both save and update)
    session_obj.merge.assert_called_once_with(execution)


def test_save_with_existing_tenant_id(repository, session):
    """Test save method with existing tenant_id."""
    session_obj, _ = session
    # Create a mock execution with existing tenant_id
    execution = MagicMock(spec=WorkflowNodeExecution)
    execution.tenant_id = "existing-tenant"
    execution.app_id = None
    execution.inputs = None
    execution.process_data = None
    execution.outputs = None
    execution.metadata = None

    # Create a modified execution that will be returned by _to_db_model
    modified_execution = MagicMock(spec=WorkflowNodeExecution)
    modified_execution.tenant_id = "existing-tenant"  # Tenant ID should not change
    modified_execution.app_id = repository._app_id  # App ID should be set

    # Mock the to_db_model method to return the modified execution
    repository.to_db_model = MagicMock(return_value=modified_execution)

    # Call save method
    repository.save(execution)

    # Assert to_db_model was called with the execution
    repository.to_db_model.assert_called_once_with(execution)

    # Assert session.merge was called with the modified execution (now using merge for both save and update)
    session_obj.merge.assert_called_once_with(modified_execution)


def test_get_by_node_execution_id(repository, session, mocker: MockerFixture):
    """Test get_by_node_execution_id method."""
    session_obj, _ = session
    # Set up mock
    mock_select = mocker.patch("core.repositories.sqlalchemy_workflow_node_execution_repository.select")
    mock_stmt = mocker.MagicMock()
    mock_select.return_value = mock_stmt
    mock_stmt.where.return_value = mock_stmt

    # Create a properly configured mock execution
    mock_execution = mocker.MagicMock(spec=WorkflowNodeExecution)
    configure_mock_execution(mock_execution)
    session_obj.scalar.return_value = mock_execution

    # Create a mock domain model to be returned by _to_domain_model
    mock_domain_model = mocker.MagicMock()
    # Mock the _to_domain_model method to return our mock domain model
    repository._to_domain_model = mocker.MagicMock(return_value=mock_domain_model)

    # Call method
    result = repository.get_by_node_execution_id("test-node-execution-id")

    # Assert select was called with correct parameters
    mock_select.assert_called_once()
    session_obj.scalar.assert_called_once_with(mock_stmt)
    # Assert _to_domain_model was called with the mock execution
    repository._to_domain_model.assert_called_once_with(mock_execution)
    # Assert the result is our mock domain model
    assert result is mock_domain_model


def test_get_by_workflow_run(repository, session, mocker: MockerFixture):
    """Test get_by_workflow_run method."""
    session_obj, _ = session
    # Set up mock
    mock_select = mocker.patch("core.repositories.sqlalchemy_workflow_node_execution_repository.select")
    mock_stmt = mocker.MagicMock()
    mock_select.return_value = mock_stmt
    mock_stmt.where.return_value = mock_stmt
    mock_stmt.order_by.return_value = mock_stmt

    # Create a properly configured mock execution
    mock_execution = mocker.MagicMock(spec=WorkflowNodeExecution)
    configure_mock_execution(mock_execution)
    session_obj.scalars.return_value.all.return_value = [mock_execution]

    # Create a mock domain model to be returned by _to_domain_model
    mock_domain_model = mocker.MagicMock()
    # Mock the _to_domain_model method to return our mock domain model
    repository._to_domain_model = mocker.MagicMock(return_value=mock_domain_model)

    # Call method
    order_config = OrderConfig(order_by=["index"], order_direction="desc")
    result = repository.get_by_workflow_run(workflow_run_id="test-workflow-run-id", order_config=order_config)

    # Assert select was called with correct parameters
    mock_select.assert_called_once()
    session_obj.scalars.assert_called_once_with(mock_stmt)
    # Assert _to_domain_model was called with the mock execution
    repository._to_domain_model.assert_called_once_with(mock_execution)
    # Assert the result contains our mock domain model
    assert len(result) == 1
    assert result[0] is mock_domain_model


def test_get_running_executions(repository, session, mocker: MockerFixture):
    """Test get_running_executions method."""
    session_obj, _ = session
    # Set up mock
    mock_select = mocker.patch("core.repositories.sqlalchemy_workflow_node_execution_repository.select")
    mock_stmt = mocker.MagicMock()
    mock_select.return_value = mock_stmt
    mock_stmt.where.return_value = mock_stmt

    # Create a properly configured mock execution
    mock_execution = mocker.MagicMock(spec=WorkflowNodeExecution)
    configure_mock_execution(mock_execution)
    session_obj.scalars.return_value.all.return_value = [mock_execution]

    # Create a mock domain model to be returned by _to_domain_model
    mock_domain_model = mocker.MagicMock()
    # Mock the _to_domain_model method to return our mock domain model
    repository._to_domain_model = mocker.MagicMock(return_value=mock_domain_model)

    # Call method
    result = repository.get_running_executions("test-workflow-run-id")

    # Assert select was called with correct parameters
    mock_select.assert_called_once()
    session_obj.scalars.assert_called_once_with(mock_stmt)
    # Assert _to_domain_model was called with the mock execution
    repository._to_domain_model.assert_called_once_with(mock_execution)
    # Assert the result contains our mock domain model
    assert len(result) == 1
    assert result[0] is mock_domain_model


def test_update_via_save(repository, session):
    """Test updating an existing record via save method."""
    session_obj, _ = session
    # Create a mock execution
    execution = MagicMock(spec=WorkflowNodeExecution)
    execution.tenant_id = None
    execution.app_id = None
    execution.inputs = None
    execution.process_data = None
    execution.outputs = None
    execution.metadata = None

    # Mock the to_db_model method to return the execution itself
    # This simulates the behavior of setting tenant_id and app_id
    repository.to_db_model = MagicMock(return_value=execution)

    # Call save method to update an existing record
    repository.save(execution)

    # Assert to_db_model was called with the execution
    repository.to_db_model.assert_called_once_with(execution)

    # Assert session.merge was called (for updates)
    session_obj.merge.assert_called_once_with(execution)


def test_clear(repository, session, mocker: MockerFixture):
    """Test clear method."""
    session_obj, _ = session
    # Set up mock
    mock_delete = mocker.patch("core.repositories.sqlalchemy_workflow_node_execution_repository.delete")
    mock_stmt = mocker.MagicMock()
    mock_delete.return_value = mock_stmt
    mock_stmt.where.return_value = mock_stmt

    # Mock the execute result with rowcount
    mock_result = mocker.MagicMock()
    mock_result.rowcount = 5  # Simulate 5 records deleted
    session_obj.execute.return_value = mock_result

    # Call method
    repository.clear()

    # Assert delete was called with correct parameters
    mock_delete.assert_called_once_with(WorkflowNodeExecution)
    mock_stmt.where.assert_called()
    session_obj.execute.assert_called_once_with(mock_stmt)
    session_obj.commit.assert_called_once()


def test_to_db_model(repository):
    """Test to_db_model method."""
    # Create a domain model
    domain_model = NodeExecution(
        id="test-id",
        workflow_id="test-workflow-id",
        node_execution_id="test-node-execution-id",
        workflow_run_id="test-workflow-run-id",
        index=1,
        predecessor_node_id="test-predecessor-id",
        node_id="test-node-id",
        node_type=NodeType.START,
        title="Test Node",
        inputs={"input_key": "input_value"},
        process_data={"process_key": "process_value"},
        outputs={"output_key": "output_value"},
        status=NodeExecutionStatus.RUNNING,
        error=None,
        elapsed_time=1.5,
        metadata={NodeRunMetadataKey.TOTAL_TOKENS: 100},
        created_at=datetime.now(),
        finished_at=None,
    )

    # Convert to DB model
    db_model = repository.to_db_model(domain_model)

    # Assert DB model has correct values
    assert isinstance(db_model, WorkflowNodeExecution)
    assert db_model.id == domain_model.id
    assert db_model.tenant_id == repository._tenant_id
    assert db_model.app_id == repository._app_id
    assert db_model.workflow_id == domain_model.workflow_id
    assert db_model.triggered_from == repository._triggered_from
    assert db_model.workflow_run_id == domain_model.workflow_run_id
    assert db_model.index == domain_model.index
    assert db_model.predecessor_node_id == domain_model.predecessor_node_id
    assert db_model.node_execution_id == domain_model.node_execution_id
    assert db_model.node_id == domain_model.node_id
    assert db_model.node_type == domain_model.node_type
    assert db_model.title == domain_model.title

    assert db_model.inputs_dict == domain_model.inputs
    assert db_model.process_data_dict == domain_model.process_data
    assert db_model.outputs_dict == domain_model.outputs
    assert db_model.execution_metadata_dict == domain_model.metadata

    assert db_model.status == domain_model.status
    assert db_model.error == domain_model.error
    assert db_model.elapsed_time == domain_model.elapsed_time
    assert db_model.created_at == domain_model.created_at
    assert db_model.created_by_role == repository._creator_user_role
    assert db_model.created_by == repository._creator_user_id
    assert db_model.finished_at == domain_model.finished_at


def test_to_domain_model(repository):
    """Test _to_domain_model method."""
    # Create input dictionaries
    inputs_dict = {"input_key": "input_value"}
    process_data_dict = {"process_key": "process_value"}
    outputs_dict = {"output_key": "output_value"}
    metadata_dict = {str(NodeRunMetadataKey.TOTAL_TOKENS): 100}

    # Create a DB model using our custom subclass
    db_model = WorkflowNodeExecution()
    db_model.id = "test-id"
    db_model.tenant_id = "test-tenant-id"
    db_model.app_id = "test-app-id"
    db_model.workflow_id = "test-workflow-id"
    db_model.triggered_from = "workflow-run"
    db_model.workflow_run_id = "test-workflow-run-id"
    db_model.index = 1
    db_model.predecessor_node_id = "test-predecessor-id"
    db_model.node_execution_id = "test-node-execution-id"
    db_model.node_id = "test-node-id"
    db_model.node_type = NodeType.START.value
    db_model.title = "Test Node"
    db_model.inputs = json.dumps(inputs_dict)
    db_model.process_data = json.dumps(process_data_dict)
    db_model.outputs = json.dumps(outputs_dict)
    db_model.status = WorkflowNodeExecutionStatus.RUNNING
    db_model.error = None
    db_model.elapsed_time = 1.5
    db_model.execution_metadata = json.dumps(metadata_dict)
    db_model.created_at = datetime.now()
    db_model.created_by_role = "account"
    db_model.created_by = "test-user-id"
    db_model.finished_at = None

    # Convert to domain model
    domain_model = repository._to_domain_model(db_model)

    # Assert domain model has correct values
    assert isinstance(domain_model, NodeExecution)
    assert domain_model.id == db_model.id
    assert domain_model.workflow_id == db_model.workflow_id
    assert domain_model.workflow_run_id == db_model.workflow_run_id
    assert domain_model.index == db_model.index
    assert domain_model.predecessor_node_id == db_model.predecessor_node_id
    assert domain_model.node_execution_id == db_model.node_execution_id
    assert domain_model.node_id == db_model.node_id
    assert domain_model.node_type == NodeType(db_model.node_type)
    assert domain_model.title == db_model.title
    assert domain_model.inputs == inputs_dict
    assert domain_model.process_data == process_data_dict
    assert domain_model.outputs == outputs_dict
    assert domain_model.status == NodeExecutionStatus(db_model.status)
    assert domain_model.error == db_model.error
    assert domain_model.elapsed_time == db_model.elapsed_time
    assert domain_model.metadata == metadata_dict
    assert domain_model.created_at == db_model.created_at
    assert domain_model.finished_at == db_model.finished_at
