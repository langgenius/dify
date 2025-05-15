"""
Unit tests for the SQLAlchemy implementation of WorkflowNodeExecutionRepository.
"""

from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from core.repositories import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.repository.workflow_node_execution_repository import OrderConfig
from models.workflow import WorkflowNodeExecution


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
def repository(session):
    """Create a repository instance with test data."""
    _, session_factory = session
    tenant_id = "test-tenant"
    app_id = "test-app"
    return SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=session_factory, tenant_id=tenant_id, app_id=app_id
    )


def test_save(repository, session):
    """Test save method."""
    session_obj, _ = session
    # Create a mock execution
    execution = MagicMock(spec=WorkflowNodeExecution)
    execution.tenant_id = None
    execution.app_id = None

    # Call save method
    repository.save(execution)

    # Assert tenant_id and app_id are set
    assert execution.tenant_id == repository._tenant_id
    assert execution.app_id == repository._app_id

    # Assert session.add was called
    session_obj.add.assert_called_once_with(execution)


def test_save_with_existing_tenant_id(repository, session):
    """Test save method with existing tenant_id."""
    session_obj, _ = session
    # Create a mock execution with existing tenant_id
    execution = MagicMock(spec=WorkflowNodeExecution)
    execution.tenant_id = "existing-tenant"
    execution.app_id = None

    # Call save method
    repository.save(execution)

    # Assert tenant_id is not changed and app_id is set
    assert execution.tenant_id == "existing-tenant"
    assert execution.app_id == repository._app_id

    # Assert session.add was called
    session_obj.add.assert_called_once_with(execution)


def test_get_by_node_execution_id(repository, session, mocker: MockerFixture):
    """Test get_by_node_execution_id method."""
    session_obj, _ = session
    # Set up mock
    mock_select = mocker.patch("core.repositories.sqlalchemy_workflow_node_execution_repository.select")
    mock_stmt = mocker.MagicMock()
    mock_select.return_value = mock_stmt
    mock_stmt.where.return_value = mock_stmt
    session_obj.scalar.return_value = mocker.MagicMock(spec=WorkflowNodeExecution)

    # Call method
    result = repository.get_by_node_execution_id("test-node-execution-id")

    # Assert select was called with correct parameters
    mock_select.assert_called_once()
    session_obj.scalar.assert_called_once_with(mock_stmt)
    assert result is not None


def test_get_by_workflow_run(repository, session, mocker: MockerFixture):
    """Test get_by_workflow_run method."""
    session_obj, _ = session
    # Set up mock
    mock_select = mocker.patch("core.repositories.sqlalchemy_workflow_node_execution_repository.select")
    mock_stmt = mocker.MagicMock()
    mock_select.return_value = mock_stmt
    mock_stmt.where.return_value = mock_stmt
    mock_stmt.order_by.return_value = mock_stmt
    session_obj.scalars.return_value.all.return_value = [mocker.MagicMock(spec=WorkflowNodeExecution)]

    # Call method
    order_config = OrderConfig(order_by=["index"], order_direction="desc")
    result = repository.get_by_workflow_run(workflow_run_id="test-workflow-run-id", order_config=order_config)

    # Assert select was called with correct parameters
    mock_select.assert_called_once()
    session_obj.scalars.assert_called_once_with(mock_stmt)
    assert len(result) == 1


def test_get_running_executions(repository, session, mocker: MockerFixture):
    """Test get_running_executions method."""
    session_obj, _ = session
    # Set up mock
    mock_select = mocker.patch("core.repositories.sqlalchemy_workflow_node_execution_repository.select")
    mock_stmt = mocker.MagicMock()
    mock_select.return_value = mock_stmt
    mock_stmt.where.return_value = mock_stmt
    session_obj.scalars.return_value.all.return_value = [mocker.MagicMock(spec=WorkflowNodeExecution)]

    # Call method
    result = repository.get_running_executions("test-workflow-run-id")

    # Assert select was called with correct parameters
    mock_select.assert_called_once()
    session_obj.scalars.assert_called_once_with(mock_stmt)
    assert len(result) == 1


def test_update(repository, session):
    """Test update method."""
    session_obj, _ = session
    # Create a mock execution
    execution = MagicMock(spec=WorkflowNodeExecution)
    execution.tenant_id = None
    execution.app_id = None

    # Call update method
    repository.update(execution)

    # Assert tenant_id and app_id are set
    assert execution.tenant_id == repository._tenant_id
    assert execution.app_id == repository._app_id

    # Assert session.merge was called
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
