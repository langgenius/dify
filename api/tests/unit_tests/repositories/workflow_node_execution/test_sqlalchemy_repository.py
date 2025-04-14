"""
Unit tests for the SQLAlchemy implementation of WorkflowNodeExecutionRepository.
"""

from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

from core.repository.workflow_node_execution_repository import WorkflowNodeExecutionCriteria
from models.workflow import WorkflowNodeExecution, WorkflowNodeExecutionStatus
from repositories.workflow_node_execution.sqlalchemy_repository import SQLAlchemyWorkflowNodeExecutionRepository


@pytest.fixture
def session():
    """Create a mock SQLAlchemy session."""
    return MagicMock(spec=Session)


@pytest.fixture
def repository(session):
    """Create a repository instance with test data."""
    tenant_id = "test-tenant"
    app_id = "test-app"
    return SQLAlchemyWorkflowNodeExecutionRepository(session=session, tenant_id=tenant_id, app_id=app_id)


def test_save(repository, session):
    """Test save method."""
    # Create a mock execution
    execution = MagicMock(spec=WorkflowNodeExecution)
    execution.tenant_id = None
    execution.app_id = None

    # Call save method
    repository.save(execution)

    # Assert tenant_id and app_id are set
    assert execution.tenant_id == repository.tenant_id
    assert execution.app_id == repository.app_id

    # Assert session.add was called
    session.add.assert_called_once_with(execution)
    session.flush.assert_called_once()


def test_save_with_existing_tenant_id(repository, session):
    """Test save method with existing tenant_id."""
    # Create a mock execution with existing tenant_id
    execution = MagicMock(spec=WorkflowNodeExecution)
    execution.tenant_id = "existing-tenant"
    execution.app_id = None

    # Call save method
    repository.save(execution)

    # Assert tenant_id is not changed and app_id is set
    assert execution.tenant_id == "existing-tenant"
    assert execution.app_id == repository.app_id

    # Assert session.add was called
    session.add.assert_called_once_with(execution)
    session.flush.assert_called_once()


def test_get_by_node_execution_id(repository, session, mocker: MockerFixture):
    """Test get_by_node_execution_id method."""
    # Set up mock
    mock_select = mocker.patch("repositories.workflow_node_execution.sqlalchemy_repository.select")
    mock_stmt = mocker.MagicMock()
    mock_select.return_value = mock_stmt
    mock_stmt.where.return_value = mock_stmt
    session.scalar.return_value = mocker.MagicMock(spec=WorkflowNodeExecution)

    # Call method
    result = repository.get_by_node_execution_id("test-node-execution-id")

    # Assert select was called with correct parameters
    mock_select.assert_called_once()
    session.scalar.assert_called_once_with(mock_stmt)
    assert result is not None


def test_get_by_workflow_run(repository, session, mocker: MockerFixture):
    """Test get_by_workflow_run method."""
    # Set up mock
    mock_select = mocker.patch("repositories.workflow_node_execution.sqlalchemy_repository.select")
    mock_stmt = mocker.MagicMock()
    mock_select.return_value = mock_stmt
    mock_stmt.where.return_value = mock_stmt
    mock_stmt.order_by.return_value = mock_stmt
    session.scalars.return_value.all.return_value = [mocker.MagicMock(spec=WorkflowNodeExecution)]

    # Call method
    result = repository.get_by_workflow_run(
        workflow_run_id="test-workflow-run-id", order_by="index", order_direction="desc"
    )

    # Assert select was called with correct parameters
    mock_select.assert_called_once()
    session.scalars.assert_called_once_with(mock_stmt)
    assert len(result) == 1


def test_get_running_executions(repository, session, mocker: MockerFixture):
    """Test get_running_executions method."""
    # Set up mock
    mock_select = mocker.patch("repositories.workflow_node_execution.sqlalchemy_repository.select")
    mock_stmt = mocker.MagicMock()
    mock_select.return_value = mock_stmt
    mock_stmt.where.return_value = mock_stmt
    session.scalars.return_value.all.return_value = [mocker.MagicMock(spec=WorkflowNodeExecution)]

    # Call method
    result = repository.get_running_executions("test-workflow-run-id")

    # Assert select was called with correct parameters
    mock_select.assert_called_once()
    session.scalars.assert_called_once_with(mock_stmt)
    assert len(result) == 1


def test_update(repository, session):
    """Test update method."""
    # Create a mock execution
    execution = MagicMock(spec=WorkflowNodeExecution)
    execution.tenant_id = None
    execution.app_id = None

    # Call update method
    repository.update(execution)

    # Assert tenant_id and app_id are set
    assert execution.tenant_id == repository.tenant_id
    assert execution.app_id == repository.app_id

    # Assert session.merge was called
    session.merge.assert_called_once_with(execution)
    session.flush.assert_called_once()


def test_delete(repository, session, mocker: MockerFixture):
    """Test delete method."""
    # Set up mock
    mock_select = mocker.patch("repositories.workflow_node_execution.sqlalchemy_repository.select")
    mock_stmt = mocker.MagicMock()
    mock_select.return_value = mock_stmt
    mock_stmt.where.return_value = mock_stmt
    mock_execution = mocker.MagicMock(spec=WorkflowNodeExecution)
    session.scalar.return_value = mock_execution

    # Call method
    repository.delete("test-execution-id")

    # Assert select was called with correct parameters
    mock_select.assert_called_once()
    session.scalar.assert_called_once_with(mock_stmt)
    session.delete.assert_called_once_with(mock_execution)
    session.flush.assert_called_once()


def test_find_by_criteria(repository, session, mocker: MockerFixture):
    """Test find_by_criteria method."""
    # Set up mock
    mock_select = mocker.patch("repositories.workflow_node_execution.sqlalchemy_repository.select")
    mock_stmt = mocker.MagicMock()
    mock_select.return_value = mock_stmt
    mock_stmt.where.return_value = mock_stmt
    mock_stmt.order_by.return_value = mock_stmt
    mock_stmt.limit.return_value = mock_stmt
    mock_stmt.offset.return_value = mock_stmt
    session.scalars.return_value.all.return_value = [mocker.MagicMock(spec=WorkflowNodeExecution)]

    # Create criteria
    criteria = WorkflowNodeExecutionCriteria(
        workflow_run_id="test-workflow-run-id",
        node_execution_id="test-node-execution-id",
        created_at_before=datetime.now(),
        created_at_after=datetime.now() - timedelta(days=1),
        status=WorkflowNodeExecutionStatus.RUNNING.value,
    )

    # Call method
    result = repository.find_by_criteria(
        criteria=criteria, order_by="created_at", order_direction="desc", limit=10, offset=0
    )

    # Assert select was called with correct parameters
    mock_select.assert_called_once()
    session.scalars.assert_called_once_with(mock_stmt)
    assert len(result) == 1
