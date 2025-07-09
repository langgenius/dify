import json
from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from core.app.app_config.entities import AppAdditionalFeatures, WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom
from core.app.entities.queue_entities import (
    QueueNodeFailedEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
)
from core.workflow.entities.workflow_execution import WorkflowExecution, WorkflowExecutionStatus, WorkflowType
from core.workflow.entities.workflow_node_execution import (
    WorkflowNodeExecution,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.nodes import NodeType
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from core.workflow.repositories.workflow_node_execution_repository import WorkflowNodeExecutionRepository
from core.workflow.system_variable import SystemVariable
from core.workflow.workflow_cycle_manager import CycleManagerWorkflowInfo, WorkflowCycleManager
from models.enums import CreatorUserRole
from models.model import AppMode
from models.workflow import Workflow, WorkflowRun


@pytest.fixture
def real_app_generate_entity():
    additional_features = AppAdditionalFeatures(
        file_upload=None,
        opening_statement=None,
        suggested_questions=[],
        suggested_questions_after_answer=False,
        show_retrieve_source=False,
        more_like_this=False,
        speech_to_text=False,
        text_to_speech=None,
        trace_config=None,
    )

    app_config = WorkflowUIBasedAppConfig(
        tenant_id="test-tenant-id",
        app_id="test-app-id",
        app_mode=AppMode.WORKFLOW,
        additional_features=additional_features,
        workflow_id="test-workflow-id",
    )

    entity = AdvancedChatAppGenerateEntity(
        task_id="test-task-id",
        app_config=app_config,
        inputs={"query": "test query"},
        files=[],
        user_id="test-user-id",
        stream=False,
        invoke_from=InvokeFrom.WEB_APP,
        query="test query",
        conversation_id="test-conversation-id",
    )

    return entity


@pytest.fixture
def real_workflow_system_variables():
    return SystemVariable(
        query="test query",
        conversation_id="test-conversation-id",
        user_id="test-user-id",
        app_id="test-app-id",
        workflow_id="test-workflow-id",
        workflow_execution_id="test-workflow-run-id",
    )


@pytest.fixture
def mock_node_execution_repository():
    repo = MagicMock(spec=WorkflowNodeExecutionRepository)
    repo.get_by_node_execution_id.return_value = None
    repo.get_running_executions.return_value = []
    return repo


@pytest.fixture
def mock_workflow_execution_repository():
    repo = MagicMock(spec=WorkflowExecutionRepository)
    repo.get.return_value = None
    return repo


@pytest.fixture
def real_workflow_entity():
    return CycleManagerWorkflowInfo(
        workflow_id="test-workflow-id",  # Matches ID used in other fixtures
        workflow_type=WorkflowType.CHAT,
        version="1.0.0",
        graph_data={
            "nodes": [
                {
                    "id": "node1",
                    "type": "chat",  # NodeType is a string enum
                    "name": "Chat Node",
                    "data": {"model": "gpt-3.5-turbo", "prompt": "test prompt"},
                }
            ],
            "edges": [],
        },
    )


@pytest.fixture
def workflow_cycle_manager(
    real_app_generate_entity,
    real_workflow_system_variables,
    mock_workflow_execution_repository,
    mock_node_execution_repository,
    real_workflow_entity,
):
    return WorkflowCycleManager(
        application_generate_entity=real_app_generate_entity,
        workflow_system_variables=real_workflow_system_variables,
        workflow_info=real_workflow_entity,
        workflow_execution_repository=mock_workflow_execution_repository,
        workflow_node_execution_repository=mock_node_execution_repository,
    )


@pytest.fixture
def mock_session():
    session = MagicMock(spec=Session)
    return session


@pytest.fixture
def real_workflow():
    workflow = Workflow()
    workflow.id = "test-workflow-id"
    workflow.tenant_id = "test-tenant-id"
    workflow.app_id = "test-app-id"
    workflow.type = "chat"
    workflow.version = "1.0"

    graph_data = {"nodes": [], "edges": []}
    workflow.graph = json.dumps(graph_data)
    workflow.features = json.dumps({"file_upload": {"enabled": False}})
    workflow.created_by = "test-user-id"
    workflow.created_at = datetime.now(UTC).replace(tzinfo=None)
    workflow.updated_at = datetime.now(UTC).replace(tzinfo=None)
    workflow._environment_variables = "{}"
    workflow._conversation_variables = "{}"

    return workflow


@pytest.fixture
def real_workflow_run():
    workflow_run = WorkflowRun()
    workflow_run.id = "test-workflow-run-id"
    workflow_run.tenant_id = "test-tenant-id"
    workflow_run.app_id = "test-app-id"
    workflow_run.workflow_id = "test-workflow-id"
    workflow_run.type = "chat"
    workflow_run.triggered_from = "app-run"
    workflow_run.version = "1.0"
    workflow_run.graph = json.dumps({"nodes": [], "edges": []})
    workflow_run.inputs = json.dumps({"query": "test query"})
    workflow_run.status = WorkflowExecutionStatus.RUNNING
    workflow_run.outputs = json.dumps({"answer": "test answer"})
    workflow_run.created_by_role = CreatorUserRole.ACCOUNT
    workflow_run.created_by = "test-user-id"
    workflow_run.created_at = datetime.now(UTC).replace(tzinfo=None)

    return workflow_run


def test_init(
    workflow_cycle_manager,
    real_app_generate_entity,
    real_workflow_system_variables,
    mock_workflow_execution_repository,
    mock_node_execution_repository,
):
    """Test initialization of WorkflowCycleManager"""
    assert workflow_cycle_manager._application_generate_entity == real_app_generate_entity
    assert workflow_cycle_manager._workflow_system_variables == real_workflow_system_variables
    assert workflow_cycle_manager._workflow_execution_repository == mock_workflow_execution_repository
    assert workflow_cycle_manager._workflow_node_execution_repository == mock_node_execution_repository


def test_handle_workflow_run_start(workflow_cycle_manager):
    """Test handle_workflow_run_start method"""
    # Call the method
    workflow_execution = workflow_cycle_manager.handle_workflow_run_start()

    # Verify the result
    assert workflow_execution.workflow_id == "test-workflow-id"

    # Verify the workflow_execution_repository.save was called
    workflow_cycle_manager._workflow_execution_repository.save.assert_called_once_with(workflow_execution)


def test_handle_workflow_run_success(workflow_cycle_manager, mock_workflow_execution_repository):
    """Test handle_workflow_run_success method"""
    # Create a real WorkflowExecution

    workflow_execution = WorkflowExecution(
        id_="test-workflow-run-id",
        workflow_id="test-workflow-id",
        workflow_version="1.0",
        workflow_type=WorkflowType.CHAT,
        graph={"nodes": [], "edges": []},
        inputs={"query": "test query"},
        started_at=datetime.now(UTC).replace(tzinfo=None),
    )

    # Mock _get_workflow_execution_or_raise_error to return the real workflow_execution
    workflow_cycle_manager._workflow_execution_repository.get.return_value = workflow_execution

    # Call the method
    result = workflow_cycle_manager.handle_workflow_run_success(
        workflow_run_id="test-workflow-run-id",
        total_tokens=100,
        total_steps=5,
        outputs={"answer": "test answer"},
    )

    # Verify the result
    assert result == workflow_execution
    assert result.status == WorkflowExecutionStatus.SUCCEEDED
    assert result.outputs == {"answer": "test answer"}
    assert result.total_tokens == 100
    assert result.total_steps == 5
    assert result.finished_at is not None


def test_handle_workflow_run_failed(workflow_cycle_manager, mock_workflow_execution_repository):
    """Test handle_workflow_run_failed method"""
    # Create a real WorkflowExecution

    workflow_execution = WorkflowExecution(
        id_="test-workflow-run-id",
        workflow_id="test-workflow-id",
        workflow_version="1.0",
        workflow_type=WorkflowType.CHAT,
        graph={"nodes": [], "edges": []},
        inputs={"query": "test query"},
        started_at=datetime.now(UTC).replace(tzinfo=None),
    )

    # Mock _get_workflow_execution_or_raise_error to return the real workflow_execution
    workflow_cycle_manager._workflow_execution_repository.get.return_value = workflow_execution

    # Mock get_running_executions to return an empty list
    workflow_cycle_manager._workflow_node_execution_repository.get_running_executions.return_value = []

    # Call the method
    result = workflow_cycle_manager.handle_workflow_run_failed(
        workflow_run_id="test-workflow-run-id",
        total_tokens=50,
        total_steps=3,
        status=WorkflowExecutionStatus.FAILED,
        error_message="Test error message",
    )

    # Verify the result
    assert result == workflow_execution
    assert result.status == WorkflowExecutionStatus.FAILED
    assert result.error_message == "Test error message"
    assert result.total_tokens == 50
    assert result.total_steps == 3
    assert result.finished_at is not None


def test_handle_node_execution_start(workflow_cycle_manager, mock_workflow_execution_repository):
    """Test handle_node_execution_start method"""
    # Create a real WorkflowExecution

    workflow_execution = WorkflowExecution(
        id_="test-workflow-execution-id",
        workflow_id="test-workflow-id",
        workflow_version="1.0",
        workflow_type=WorkflowType.CHAT,
        graph={"nodes": [], "edges": []},
        inputs={"query": "test query"},
        started_at=datetime.now(UTC).replace(tzinfo=None),
    )

    # Mock _get_workflow_execution_or_raise_error to return the real workflow_execution
    workflow_cycle_manager._workflow_execution_repository.get.return_value = workflow_execution

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
    result = workflow_cycle_manager.handle_node_execution_start(
        workflow_execution_id=workflow_execution.id_,
        event=event,
    )

    # Verify the result
    assert result.workflow_id == workflow_execution.workflow_id
    assert result.workflow_execution_id == workflow_execution.id_
    assert result.node_execution_id == event.node_execution_id
    assert result.node_id == event.node_id
    assert result.node_type == event.node_type
    assert result.title == event.node_data.title
    assert result.status == WorkflowNodeExecutionStatus.RUNNING

    # Verify save was called
    workflow_cycle_manager._workflow_node_execution_repository.save.assert_called_once_with(result)


def test_get_workflow_execution_or_raise_error(workflow_cycle_manager, mock_workflow_execution_repository):
    """Test _get_workflow_execution_or_raise_error method"""
    # Create a real WorkflowExecution

    workflow_execution = WorkflowExecution(
        id_="test-workflow-run-id",
        workflow_id="test-workflow-id",
        workflow_version="1.0",
        workflow_type=WorkflowType.CHAT,
        graph={"nodes": [], "edges": []},
        inputs={"query": "test query"},
        started_at=datetime.now(UTC).replace(tzinfo=None),
    )

    # Mock the repository get method to return the real execution
    workflow_cycle_manager._workflow_execution_repository.get.return_value = workflow_execution

    # Call the method
    result = workflow_cycle_manager._get_workflow_execution_or_raise_error("test-workflow-run-id")

    # Verify the result
    assert result == workflow_execution

    # Test error case
    workflow_cycle_manager._workflow_execution_repository.get.return_value = None

    # Expect an error when execution is not found
    with pytest.raises(ValueError):
        workflow_cycle_manager._get_workflow_execution_or_raise_error("non-existent-id")


def test_handle_workflow_node_execution_success(workflow_cycle_manager):
    """Test handle_workflow_node_execution_success method"""
    # Create a mock event
    event = MagicMock(spec=QueueNodeSucceededEvent)
    event.node_execution_id = "test-node-execution-id"
    event.inputs = {"input": "test input"}
    event.process_data = {"process": "test process"}
    event.outputs = {"output": "test output"}
    event.execution_metadata = {WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 100}
    event.start_at = datetime.now(UTC).replace(tzinfo=None)

    # Create a real node execution

    node_execution = WorkflowNodeExecution(
        id="test-node-execution-record-id",
        node_execution_id="test-node-execution-id",
        workflow_id="test-workflow-id",
        workflow_execution_id="test-workflow-run-id",
        index=1,
        node_id="test-node-id",
        node_type=NodeType.LLM,
        title="Test Node",
        created_at=datetime.now(UTC).replace(tzinfo=None),
    )

    # Mock the repository to return the node execution
    workflow_cycle_manager._workflow_node_execution_repository.get_by_node_execution_id.return_value = node_execution

    # Call the method
    result = workflow_cycle_manager.handle_workflow_node_execution_success(
        event=event,
    )

    # Verify the result
    assert result == node_execution
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED

    # Verify save was called
    workflow_cycle_manager._workflow_node_execution_repository.save.assert_called_once_with(node_execution)


def test_handle_workflow_run_partial_success(workflow_cycle_manager, mock_workflow_execution_repository):
    """Test handle_workflow_run_partial_success method"""
    # Create a real WorkflowExecution

    workflow_execution = WorkflowExecution(
        id_="test-workflow-run-id",
        workflow_id="test-workflow-id",
        workflow_version="1.0",
        workflow_type=WorkflowType.CHAT,
        graph={"nodes": [], "edges": []},
        inputs={"query": "test query"},
        started_at=datetime.now(UTC).replace(tzinfo=None),
    )

    # Mock _get_workflow_execution_or_raise_error to return the real workflow_execution
    workflow_cycle_manager._workflow_execution_repository.get.return_value = workflow_execution

    # Call the method
    result = workflow_cycle_manager.handle_workflow_run_partial_success(
        workflow_run_id="test-workflow-run-id",
        total_tokens=75,
        total_steps=4,
        outputs={"partial_answer": "test partial answer"},
        exceptions_count=2,
    )

    # Verify the result
    assert result == workflow_execution
    assert result.status == WorkflowExecutionStatus.PARTIAL_SUCCEEDED
    assert result.outputs == {"partial_answer": "test partial answer"}
    assert result.total_tokens == 75
    assert result.total_steps == 4
    assert result.exceptions_count == 2
    assert result.finished_at is not None


def test_handle_workflow_node_execution_failed(workflow_cycle_manager):
    """Test handle_workflow_node_execution_failed method"""
    # Create a mock event
    event = MagicMock(spec=QueueNodeFailedEvent)
    event.node_execution_id = "test-node-execution-id"
    event.inputs = {"input": "test input"}
    event.process_data = {"process": "test process"}
    event.outputs = {"output": "test output"}
    event.execution_metadata = {WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 100}
    event.start_at = datetime.now(UTC).replace(tzinfo=None)
    event.error = "Test error message"

    # Create a real node execution

    node_execution = WorkflowNodeExecution(
        id="test-node-execution-record-id",
        node_execution_id="test-node-execution-id",
        workflow_id="test-workflow-id",
        workflow_execution_id="test-workflow-run-id",
        index=1,
        node_id="test-node-id",
        node_type=NodeType.LLM,
        title="Test Node",
        created_at=datetime.now(UTC).replace(tzinfo=None),
    )

    # Mock the repository to return the node execution
    workflow_cycle_manager._workflow_node_execution_repository.get_by_node_execution_id.return_value = node_execution

    # Call the method
    result = workflow_cycle_manager.handle_workflow_node_execution_failed(
        event=event,
    )

    # Verify the result
    assert result == node_execution
    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error == "Test error message"

    # Verify save was called
    workflow_cycle_manager._workflow_node_execution_repository.save.assert_called_once_with(node_execution)
