import json
import time
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom
from core.app.entities.queue_entities import (
    QueueNodeFailedEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
)
from core.workflow.enums import SystemVariableKey
from core.workflow.nodes import NodeType
from core.workflow.repository.workflow_node_execution_repository import WorkflowNodeExecutionRepository
from core.workflow.workflow_cycle_manager import WorkflowCycleManager
from models.enums import CreatedByRole
from models.workflow import (
    Workflow,
    WorkflowNodeExecution,
    WorkflowNodeExecutionStatus,
    WorkflowRun,
    WorkflowRunStatus,
)


@pytest.fixture
def mock_app_generate_entity():
    entity = MagicMock(spec=AdvancedChatAppGenerateEntity)
    entity.inputs = {"query": "test query"}
    entity.invoke_from = InvokeFrom.WEB_APP
    # Create app_config as a separate mock
    app_config = MagicMock()
    app_config.tenant_id = "test-tenant-id"
    app_config.app_id = "test-app-id"
    entity.app_config = app_config
    return entity


@pytest.fixture
def mock_workflow_system_variables():
    return {
        SystemVariableKey.QUERY: "test query",
        SystemVariableKey.CONVERSATION_ID: "test-conversation-id",
        SystemVariableKey.USER_ID: "test-user-id",
        SystemVariableKey.APP_ID: "test-app-id",
        SystemVariableKey.WORKFLOW_ID: "test-workflow-id",
        SystemVariableKey.WORKFLOW_RUN_ID: "test-workflow-run-id",
    }


@pytest.fixture
def mock_node_execution_repository():
    repo = MagicMock(spec=WorkflowNodeExecutionRepository)
    repo.get_by_node_execution_id.return_value = None
    repo.get_running_executions.return_value = []
    return repo


@pytest.fixture
def workflow_cycle_manager(mock_app_generate_entity, mock_workflow_system_variables, mock_node_execution_repository):
    return WorkflowCycleManager(
        application_generate_entity=mock_app_generate_entity,
        workflow_system_variables=mock_workflow_system_variables,
        workflow_node_execution_repository=mock_node_execution_repository,
    )


@pytest.fixture
def mock_session():
    session = MagicMock(spec=Session)
    return session


@pytest.fixture
def mock_workflow():
    workflow = MagicMock(spec=Workflow)
    workflow.id = "test-workflow-id"
    workflow.tenant_id = "test-tenant-id"
    workflow.app_id = "test-app-id"
    workflow.type = "chat"
    workflow.version = "1.0"
    workflow.graph = json.dumps({"nodes": [], "edges": []})
    return workflow


@pytest.fixture
def mock_workflow_run():
    workflow_run = MagicMock(spec=WorkflowRun)
    workflow_run.id = "test-workflow-run-id"
    workflow_run.tenant_id = "test-tenant-id"
    workflow_run.app_id = "test-app-id"
    workflow_run.workflow_id = "test-workflow-id"
    workflow_run.status = WorkflowRunStatus.RUNNING
    workflow_run.created_by_role = CreatedByRole.ACCOUNT
    workflow_run.created_by = "test-user-id"
    workflow_run.created_at = datetime.now(UTC).replace(tzinfo=None)
    workflow_run.inputs_dict = {"query": "test query"}
    workflow_run.outputs_dict = {"answer": "test answer"}
    return workflow_run


def test_init(
    workflow_cycle_manager, mock_app_generate_entity, mock_workflow_system_variables, mock_node_execution_repository
):
    """Test initialization of WorkflowCycleManager"""
    assert workflow_cycle_manager._workflow_run is None
    assert workflow_cycle_manager._workflow_node_executions == {}
    assert workflow_cycle_manager._application_generate_entity == mock_app_generate_entity
    assert workflow_cycle_manager._workflow_system_variables == mock_workflow_system_variables
    assert workflow_cycle_manager._workflow_node_execution_repository == mock_node_execution_repository


def test_handle_workflow_run_start(workflow_cycle_manager, mock_session, mock_workflow):
    """Test _handle_workflow_run_start method"""
    # Mock session.scalar to return the workflow and max sequence
    mock_session.scalar.side_effect = [mock_workflow, 5]

    # Call the method
    workflow_run = workflow_cycle_manager._handle_workflow_run_start(
        session=mock_session,
        workflow_id="test-workflow-id",
        user_id="test-user-id",
        created_by_role=CreatedByRole.ACCOUNT,
    )

    # Verify the result
    assert workflow_run.tenant_id == mock_workflow.tenant_id
    assert workflow_run.app_id == mock_workflow.app_id
    assert workflow_run.workflow_id == mock_workflow.id
    assert workflow_run.sequence_number == 6  # max_sequence + 1
    assert workflow_run.status == WorkflowRunStatus.RUNNING
    assert workflow_run.created_by_role == CreatedByRole.ACCOUNT
    assert workflow_run.created_by == "test-user-id"

    # Verify session.add was called
    mock_session.add.assert_called_once_with(workflow_run)


def test_handle_workflow_run_success(workflow_cycle_manager, mock_session, mock_workflow_run):
    """Test _handle_workflow_run_success method"""
    # Mock _get_workflow_run to return the mock_workflow_run
    with patch.object(workflow_cycle_manager, "_get_workflow_run", return_value=mock_workflow_run):
        # Call the method
        result = workflow_cycle_manager._handle_workflow_run_success(
            session=mock_session,
            workflow_run_id="test-workflow-run-id",
            start_at=time.perf_counter() - 10,  # 10 seconds ago
            total_tokens=100,
            total_steps=5,
            outputs={"answer": "test answer"},
        )

        # Verify the result
        assert result == mock_workflow_run
        assert result.status == WorkflowRunStatus.SUCCEEDED
        assert result.outputs == json.dumps({"answer": "test answer"})
        assert result.total_tokens == 100
        assert result.total_steps == 5
        assert result.finished_at is not None


def test_handle_workflow_run_failed(workflow_cycle_manager, mock_session, mock_workflow_run):
    """Test _handle_workflow_run_failed method"""
    # Mock _get_workflow_run to return the mock_workflow_run
    with patch.object(workflow_cycle_manager, "_get_workflow_run", return_value=mock_workflow_run):
        # Mock get_running_executions to return an empty list
        workflow_cycle_manager._workflow_node_execution_repository.get_running_executions.return_value = []

        # Call the method
        result = workflow_cycle_manager._handle_workflow_run_failed(
            session=mock_session,
            workflow_run_id="test-workflow-run-id",
            start_at=time.perf_counter() - 10,  # 10 seconds ago
            total_tokens=50,
            total_steps=3,
            status=WorkflowRunStatus.FAILED,
            error="Test error message",
        )

        # Verify the result
        assert result == mock_workflow_run
        assert result.status == WorkflowRunStatus.FAILED.value
        assert result.error == "Test error message"
        assert result.total_tokens == 50
        assert result.total_steps == 3
        assert result.finished_at is not None


def test_handle_node_execution_start(workflow_cycle_manager, mock_workflow_run):
    """Test _handle_node_execution_start method"""
    # Create a mock event
    event = MagicMock(spec=QueueNodeStartedEvent)
    event.node_execution_id = "test-node-execution-id"
    event.node_id = "test-node-id"
    event.node_type = NodeType.LLM

    # Create node_data as a separate mock
    node_data = MagicMock()
    node_data.title = "Test Node"
    event.node_data = node_data

    event.predecessor_node_id = "test-predecessor-node-id"
    event.node_run_index = 1
    event.parallel_mode_run_id = "test-parallel-mode-run-id"
    event.in_iteration_id = "test-iteration-id"
    event.in_loop_id = "test-loop-id"

    # Call the method
    result = workflow_cycle_manager._handle_node_execution_start(
        workflow_run=mock_workflow_run,
        event=event,
    )

    # Verify the result
    assert result.tenant_id == mock_workflow_run.tenant_id
    assert result.app_id == mock_workflow_run.app_id
    assert result.workflow_id == mock_workflow_run.workflow_id
    assert result.workflow_run_id == mock_workflow_run.id
    assert result.node_execution_id == event.node_execution_id
    assert result.node_id == event.node_id
    assert result.node_type == event.node_type.value
    assert result.title == event.node_data.title
    assert result.status == WorkflowNodeExecutionStatus.RUNNING.value
    assert result.created_by_role == mock_workflow_run.created_by_role
    assert result.created_by == mock_workflow_run.created_by

    # Verify save was called
    workflow_cycle_manager._workflow_node_execution_repository.save.assert_called_once_with(result)

    # Verify the node execution was added to the cache
    assert workflow_cycle_manager._workflow_node_executions[event.node_execution_id] == result


def test_get_workflow_run(workflow_cycle_manager, mock_session, mock_workflow_run):
    """Test _get_workflow_run method"""
    # Mock session.scalar to return the workflow run
    mock_session.scalar.return_value = mock_workflow_run

    # Call the method
    result = workflow_cycle_manager._get_workflow_run(
        session=mock_session,
        workflow_run_id="test-workflow-run-id",
    )

    # Verify the result
    assert result == mock_workflow_run
    assert workflow_cycle_manager._workflow_run == mock_workflow_run


def test_handle_workflow_node_execution_success(workflow_cycle_manager):
    """Test _handle_workflow_node_execution_success method"""
    # Create a mock event
    event = MagicMock(spec=QueueNodeSucceededEvent)
    event.node_execution_id = "test-node-execution-id"
    event.inputs = {"input": "test input"}
    event.process_data = {"process": "test process"}
    event.outputs = {"output": "test output"}
    event.execution_metadata = {"metadata": "test metadata"}
    event.start_at = datetime.now(UTC).replace(tzinfo=None)

    # Create a mock workflow node execution
    node_execution = MagicMock(spec=WorkflowNodeExecution)
    node_execution.node_execution_id = "test-node-execution-id"

    # Mock _get_workflow_node_execution to return the mock node execution
    with patch.object(workflow_cycle_manager, "_get_workflow_node_execution", return_value=node_execution):
        # Call the method
        result = workflow_cycle_manager._handle_workflow_node_execution_success(
            event=event,
        )

        # Verify the result
        assert result == node_execution
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED.value
        assert result.inputs == json.dumps(event.inputs)
        assert result.process_data == json.dumps(event.process_data)
        assert result.outputs == json.dumps(event.outputs)
        assert result.finished_at is not None
        assert result.elapsed_time is not None

        # Verify update was called
        workflow_cycle_manager._workflow_node_execution_repository.update.assert_called_once_with(node_execution)


def test_handle_workflow_run_partial_success(workflow_cycle_manager, mock_session, mock_workflow_run):
    """Test _handle_workflow_run_partial_success method"""
    # Mock _get_workflow_run to return the mock_workflow_run
    with patch.object(workflow_cycle_manager, "_get_workflow_run", return_value=mock_workflow_run):
        # Call the method
        result = workflow_cycle_manager._handle_workflow_run_partial_success(
            session=mock_session,
            workflow_run_id="test-workflow-run-id",
            start_at=time.perf_counter() - 10,  # 10 seconds ago
            total_tokens=75,
            total_steps=4,
            outputs={"partial_answer": "test partial answer"},
            exceptions_count=2,
        )

        # Verify the result
        assert result == mock_workflow_run
        assert result.status == WorkflowRunStatus.PARTIAL_SUCCEEDED.value
        assert result.outputs == json.dumps({"partial_answer": "test partial answer"})
        assert result.total_tokens == 75
        assert result.total_steps == 4
        assert result.exceptions_count == 2
        assert result.finished_at is not None


def test_handle_workflow_node_execution_failed(workflow_cycle_manager):
    """Test _handle_workflow_node_execution_failed method"""
    # Create a mock event
    event = MagicMock(spec=QueueNodeFailedEvent)
    event.node_execution_id = "test-node-execution-id"
    event.inputs = {"input": "test input"}
    event.process_data = {"process": "test process"}
    event.outputs = {"output": "test output"}
    event.execution_metadata = {"metadata": "test metadata"}
    event.start_at = datetime.now(UTC).replace(tzinfo=None)
    event.error = "Test error message"

    # Create a mock workflow node execution
    node_execution = MagicMock(spec=WorkflowNodeExecution)
    node_execution.node_execution_id = "test-node-execution-id"

    # Mock _get_workflow_node_execution to return the mock node execution
    with patch.object(workflow_cycle_manager, "_get_workflow_node_execution", return_value=node_execution):
        # Call the method
        result = workflow_cycle_manager._handle_workflow_node_execution_failed(
            event=event,
        )

        # Verify the result
        assert result == node_execution
        assert result.status == WorkflowNodeExecutionStatus.FAILED.value
        assert result.error == "Test error message"
        assert result.inputs == json.dumps(event.inputs)
        assert result.process_data == json.dumps(event.process_data)
        assert result.outputs == json.dumps(event.outputs)
        assert result.finished_at is not None
        assert result.elapsed_time is not None
        assert result.execution_metadata == json.dumps(event.execution_metadata)

        # Verify update was called
        workflow_cycle_manager._workflow_node_execution_repository.update.assert_called_once_with(node_execution)
