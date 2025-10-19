"""
Unit tests for the SQLAlchemy implementation of WorkflowNodeExecutionRepository.
"""

import json
import uuid
from datetime import datetime
from decimal import Decimal
from unittest.mock import MagicMock, PropertyMock

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from core.model_runtime.utils.encoders import jsonable_encoder
from core.repositories import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.entities import (
    WorkflowNodeExecution,
)
from core.workflow.enums import (
    NodeType,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.repositories.workflow_node_execution_repository import OrderConfig
from models.account import Account, Tenant
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom


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
    user = Account(name="test", email="test@example.com")
    user.id = "test-user-id"

    tenant = Tenant(name="Test Workspace")
    tenant.id = "test-tenant"
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
    execution.id = "test-id"
    execution.node_execution_id = "test-node-execution-id"
    execution.tenant_id = None
    execution.app_id = None
    execution.inputs = None
    execution.process_data = None
    execution.outputs = None
    execution.metadata = None
    execution.workflow_id = str(uuid.uuid4())

    # Mock the to_db_model method to return the execution itself
    # This simulates the behavior of setting tenant_id and app_id
    db_model = MagicMock(spec=WorkflowNodeExecutionModel)
    db_model.id = "test-id"
    db_model.node_execution_id = "test-node-execution-id"
    repository._to_db_model = MagicMock(return_value=db_model)

    # Mock session.get to return None (no existing record)
    session_obj.get.return_value = None

    # Call save method
    repository.save(execution)

    # Assert to_db_model was called with the execution
    repository._to_db_model.assert_called_once_with(execution)

    # Assert session.get was called to check for existing record
    session_obj.get.assert_called_once_with(WorkflowNodeExecutionModel, db_model.id)

    # Assert session.add was called for new record
    session_obj.add.assert_called_once_with(db_model)

    # Assert session.commit was called
    session_obj.commit.assert_called_once()


def test_save_with_existing_tenant_id(repository, session):
    """Test save method with existing tenant_id."""
    session_obj, _ = session
    # Create a mock execution with existing tenant_id
    execution = MagicMock(spec=WorkflowNodeExecutionModel)
    execution.id = "existing-id"
    execution.node_execution_id = "existing-node-execution-id"
    execution.tenant_id = "existing-tenant"
    execution.app_id = None
    execution.inputs = None
    execution.process_data = None
    execution.outputs = None
    execution.metadata = None

    # Create a modified execution that will be returned by _to_db_model
    modified_execution = MagicMock(spec=WorkflowNodeExecutionModel)
    modified_execution.id = "existing-id"
    modified_execution.node_execution_id = "existing-node-execution-id"
    modified_execution.tenant_id = "existing-tenant"  # Tenant ID should not change
    modified_execution.app_id = repository._app_id  # App ID should be set
    # Create a dictionary to simulate __dict__ for updating attributes
    modified_execution.__dict__ = {
        "id": "existing-id",
        "node_execution_id": "existing-node-execution-id",
        "tenant_id": "existing-tenant",
        "app_id": repository._app_id,
    }

    # Mock the to_db_model method to return the modified execution
    repository._to_db_model = MagicMock(return_value=modified_execution)

    # Mock session.get to return an existing record
    existing_model = MagicMock(spec=WorkflowNodeExecutionModel)
    session_obj.get.return_value = existing_model

    # Call save method
    repository.save(execution)

    # Assert to_db_model was called with the execution
    repository._to_db_model.assert_called_once_with(execution)

    # Assert session.get was called to check for existing record
    session_obj.get.assert_called_once_with(WorkflowNodeExecutionModel, modified_execution.id)

    # Assert session.add was NOT called since we're updating existing
    session_obj.add.assert_not_called()

    # Assert session.commit was called
    session_obj.commit.assert_called_once()


def test_get_by_workflow_run(repository, session, mocker: MockerFixture):
    """Test get_by_workflow_run method."""
    session_obj, _ = session
    # Set up mock
    mock_select = mocker.patch("core.repositories.sqlalchemy_workflow_node_execution_repository.select")
    mock_asc = mocker.patch("core.repositories.sqlalchemy_workflow_node_execution_repository.asc")
    mock_desc = mocker.patch("core.repositories.sqlalchemy_workflow_node_execution_repository.desc")

    mock_WorkflowNodeExecutionModel = mocker.patch(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.WorkflowNodeExecutionModel"
    )
    mock_stmt = mocker.MagicMock()
    mock_select.return_value = mock_stmt
    mock_stmt.where.return_value = mock_stmt
    mock_stmt.order_by.return_value = mock_stmt
    mock_asc.return_value = mock_stmt
    mock_desc.return_value = mock_stmt
    mock_WorkflowNodeExecutionModel.preload_offload_data_and_files.return_value = mock_stmt

    # Create a properly configured mock execution
    mock_execution = mocker.MagicMock(spec=WorkflowNodeExecutionModel)
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
    mock_WorkflowNodeExecutionModel.preload_offload_data_and_files.assert_called_once_with(mock_stmt)
    # Assert _to_domain_model was called with the mock execution
    repository._to_domain_model.assert_called_once_with(mock_execution)
    # Assert the result contains our mock domain model
    assert len(result) == 1
    assert result[0] is mock_domain_model


def test_to_db_model(repository):
    """Test to_db_model method."""
    # Create a domain model
    domain_model = WorkflowNodeExecution(
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

    # Convert to DB model
    db_model = repository._to_db_model(domain_model)

    # Assert DB model has correct values
    assert isinstance(db_model, WorkflowNodeExecutionModel)
    assert db_model.id == domain_model.id
    assert db_model.tenant_id == repository._tenant_id
    assert db_model.app_id == repository._app_id
    assert db_model.workflow_id == domain_model.workflow_id
    assert db_model.triggered_from == repository._triggered_from
    assert db_model.workflow_run_id == domain_model.workflow_execution_id
    assert db_model.index == domain_model.index
    assert db_model.predecessor_node_id == domain_model.predecessor_node_id
    assert db_model.node_execution_id == domain_model.node_execution_id
    assert db_model.node_id == domain_model.node_id
    assert db_model.node_type == domain_model.node_type
    assert db_model.title == domain_model.title

    assert db_model.inputs_dict == domain_model.inputs
    assert db_model.process_data_dict == domain_model.process_data
    assert db_model.outputs_dict == domain_model.outputs
    assert db_model.execution_metadata_dict == jsonable_encoder(domain_model.metadata)

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
    metadata_dict = {str(WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS): 100}

    # Create a DB model using our custom subclass
    db_model = WorkflowNodeExecutionModel()
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
    db_model.node_type = NodeType.START
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
    assert isinstance(domain_model, WorkflowNodeExecution)
    assert domain_model.id == db_model.id
    assert domain_model.workflow_id == db_model.workflow_id
    assert domain_model.workflow_execution_id == db_model.workflow_run_id
    assert domain_model.index == db_model.index
    assert domain_model.predecessor_node_id == db_model.predecessor_node_id
    assert domain_model.node_execution_id == db_model.node_execution_id
    assert domain_model.node_id == db_model.node_id
    assert domain_model.node_type == NodeType(db_model.node_type)
    assert domain_model.title == db_model.title
    assert domain_model.inputs == inputs_dict
    assert domain_model.process_data == process_data_dict
    assert domain_model.outputs == outputs_dict
    assert domain_model.status == WorkflowNodeExecutionStatus(db_model.status)
    assert domain_model.error == db_model.error
    assert domain_model.elapsed_time == db_model.elapsed_time
    assert domain_model.metadata == metadata_dict
    assert domain_model.created_at == db_model.created_at
    assert domain_model.finished_at == db_model.finished_at
