import json
from time import time
from unittest.mock import Mock
from uuid import uuid4

import pytest

from core.app.layers.persist_layer import PauseStatePersistenceLayer
from core.variables.segments import Segment
from core.workflow.enums import WorkflowExecutionStatus
from core.workflow.graph_engine.entities.commands import GraphEngineCommand
from core.workflow.graph_events.graph import (
    GraphRunFailedEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
)
from core.workflow.graph_events.pause_reason import SchedulingPause
from core.workflow.runtime.graph_runtime_state_protocol import ReadOnlyVariablePool
from models.workflow import Workflow, WorkflowRun
from services.workflow_run_service import WorkflowRunService


class TestDataFactory:
    """Factory for creating test data objects."""

    @staticmethod
    def create_workflow(
        workflow_id: str | None = None,
        tenant_id: str | None = None,
        app_id: str | None = None,
        created_by: str | None = None,
    ) -> Workflow:
        """Create a mock Workflow instance for testing."""
        workflow = Mock(spec=Workflow)
        workflow.id = workflow_id or str(uuid4())
        workflow.tenant_id = tenant_id or str(uuid4())
        workflow.app_id = app_id or str(uuid4())
        workflow.created_by = created_by or str(uuid4())
        return workflow

    @staticmethod
    def create_workflow_run(
        workflow_run_id: str | None = None,
        tenant_id: str | None = None,
        app_id: str | None = None,
        workflow_id: str | None = None,
        status: str = WorkflowExecutionStatus.RUNNING,
    ) -> WorkflowRun:
        """Create a mock WorkflowRun instance for testing."""
        workflow_run = Mock(spec=WorkflowRun)
        workflow_run.id = workflow_run_id or str(uuid4())
        workflow_run.tenant_id = tenant_id or str(uuid4())
        workflow_run.app_id = app_id or str(uuid4())
        workflow_run.workflow_id = workflow_id or str(uuid4())
        workflow_run.status = status
        return workflow_run

    @staticmethod
    def create_graph_run_paused_event(
        reason: str | None = None,
        outputs: dict[str, object] | None = None,
    ) -> GraphRunPausedEvent:
        """Create a GraphRunPausedEvent for testing."""
        return GraphRunPausedEvent(reason=SchedulingPause(), outputs=outputs or {})

    @staticmethod
    def create_graph_run_started_event() -> GraphRunStartedEvent:
        """Create a GraphRunStartedEvent for testing."""
        return GraphRunStartedEvent()

    @staticmethod
    def create_graph_run_succeeded_event(
        outputs: dict[str, object] | None = None,
    ) -> GraphRunSucceededEvent:
        """Create a GraphRunSucceededEvent for testing."""
        return GraphRunSucceededEvent(outputs=outputs or {})

    @staticmethod
    def create_graph_run_failed_event(
        error: str = "Test error",
        exceptions_count: int = 1,
    ) -> GraphRunFailedEvent:
        """Create a GraphRunFailedEvent for testing."""
        return GraphRunFailedEvent(error=error, exceptions_count=exceptions_count)


class MockReadOnlyVariablePool:
    """Mock implementation of ReadOnlyVariablePool for testing."""

    def __init__(self, variables: dict[tuple[str, str], object] | None = None):
        self._variables = variables or {}

    def get(self, node_id: str, variable_key: str) -> Segment | None:
        """Get a variable value (read-only)."""
        value = self._variables.get((node_id, variable_key))
        if value is None:
            return None
        # Create a mock Segment for testing
        mock_segment = Mock(spec=Segment)
        mock_segment.value = value
        return mock_segment

    def get_all_by_node(self, node_id: str) -> dict[str, object]:
        """Get all variables for a node (read-only)."""
        return {key: value for (nid, key), value in self._variables.items() if nid == node_id}

    def get_by_prefix(self, prefix: str) -> dict[str, object]:
        """Get all variables stored under a given node prefix (read-only)."""
        return {f"{nid}.{key}": value for (nid, key), value in self._variables.items() if nid.startswith(prefix)}


class MockReadOnlyGraphRuntimeState:
    """Mock implementation of ReadOnlyGraphRuntimeState for testing."""

    def __init__(
        self,
        start_at: float | None = None,
        total_tokens: int = 0,
        node_run_steps: int = 0,
        ready_queue_size: int = 0,
        exceptions_count: int = 0,
        outputs: dict[str, object] | None = None,
        variables: dict[tuple[str, str], object] | None = None,
    ):
        self._start_at = start_at or time()
        self._total_tokens = total_tokens
        self._node_run_steps = node_run_steps
        self._ready_queue_size = ready_queue_size
        self._exceptions_count = exceptions_count
        self._outputs = outputs or {}
        self._variable_pool = MockReadOnlyVariablePool(variables)

    @property
    def variable_pool(self) -> ReadOnlyVariablePool:
        """Get read-only access to the variable pool."""
        return self._variable_pool

    @property
    def start_at(self) -> float:
        """Get the start time (read-only)."""
        return self._start_at

    @property
    def total_tokens(self) -> int:
        """Get the total tokens count (read-only)."""
        return self._total_tokens

    @property
    def node_run_steps(self) -> int:
        """Get the node run steps count (read-only)."""
        return self._node_run_steps

    @property
    def ready_queue_size(self) -> int:
        """Get the number of nodes currently in the ready queue."""
        return self._ready_queue_size

    @property
    def exceptions_count(self) -> int:
        """Get the number of node execution exceptions recorded."""
        return self._exceptions_count

    @property
    def outputs(self) -> dict[str, object]:
        """Get a defensive copy of outputs (read-only)."""
        return self._outputs.copy()

    @property
    def llm_usage(self):
        """Get a copy of LLM usage info (read-only)."""
        mock_usage = Mock()
        mock_usage.prompt_tokens = 10
        mock_usage.completion_tokens = 20
        mock_usage.total_tokens = 30
        return mock_usage

    def get_output(self, key: str, default: object = None) -> object:
        """Get a single output value (returns a copy)."""
        return self._outputs.get(key, default)

    def dumps(self) -> str:
        """Serialize the runtime state into a JSON snapshot (read-only)."""
        return json.dumps(
            {
                "start_at": self._start_at,
                "total_tokens": self._total_tokens,
                "node_run_steps": self._node_run_steps,
                "ready_queue_size": self._ready_queue_size,
                "exceptions_count": self._exceptions_count,
                "outputs": self._outputs,
                "variables": {f"{k[0]}.{k[1]}": v for k, v in self._variable_pool._variables.items()},
            }
        )


class MockCommandChannel:
    """Mock implementation of CommandChannel for testing."""

    def __init__(self):
        self._commands: list[GraphEngineCommand] = []

    def fetch_commands(self) -> list[GraphEngineCommand]:
        """Fetch pending commands for this GraphEngine instance."""
        return self._commands.copy()

    def send_command(self, command: GraphEngineCommand) -> None:
        """Send a command to be processed by this GraphEngine instance."""
        self._commands.append(command)


def create_mock_workflow_run_service():
    """Create a mock WorkflowRunService for testing."""
    mock_service = Mock(spec=WorkflowRunService)
    mock_service.save_pause_state_calls = []

    def mock_save_pause_state(workflow_run: WorkflowRun, state_owner_user_id: str, state: str):
        mock_service.save_pause_state_calls.append(
            {
                "workflow_run": workflow_run,
                "state_owner_user_id": state_owner_user_id,
                "state": state,
            }
        )
        mock_pause_entity = Mock()
        mock_pause_entity.id = str(uuid4())
        mock_pause_entity.workflow_id = workflow_run.workflow_id
        mock_pause_entity.workflow_run_id = workflow_run.id
        return mock_pause_entity

    mock_service.save_pause_state = mock_save_pause_state
    return mock_service


class TestPauseStatePersistenceLayer:
    """Comprehensive unit tests for PauseStatePersistenceLayer."""

    def test_init_with_dependency_injection(self):
        """Test __init__ method with proper dependency injection."""
        # Arrange
        workflow_run_service = create_mock_workflow_run_service()
        workflow_run = TestDataFactory.create_workflow_run()
        workflow = TestDataFactory.create_workflow()

        # Act
        layer = PauseStatePersistenceLayer(
            workflow_run_service=workflow_run_service,
            workflow_run=workflow_run,
            workflow=workflow,
        )

        # Assert
        assert layer._workflow_run_service is workflow_run_service
        assert layer._workflow_run is workflow_run
        assert layer._workflow is workflow
        # The layer doesn't call parent __init__, so these attributes don't exist until initialize is called
        assert not hasattr(layer, "graph_runtime_state")
        assert not hasattr(layer, "command_channel")

    def test_initialize_sets_dependencies(self):
        """Test initialize method properly sets graph_runtime_state and command_channel."""
        # Arrange
        workflow_run_service = create_mock_workflow_run_service()
        workflow_run = TestDataFactory.create_workflow_run()
        workflow = TestDataFactory.create_workflow()
        layer = PauseStatePersistenceLayer(
            workflow_run_service=workflow_run_service,
            workflow_run=workflow_run,
            workflow=workflow,
        )

        graph_runtime_state = MockReadOnlyGraphRuntimeState()
        command_channel = MockCommandChannel()

        # Act
        layer.initialize(graph_runtime_state, command_channel)

        # Assert
        assert layer.graph_runtime_state is graph_runtime_state
        assert layer.command_channel is command_channel

    def test_on_event_with_graph_run_paused_event(self):
        """Test on_event method with GraphRunPausedEvent triggers save_pause_state."""
        # Arrange
        workflow_run_service = create_mock_workflow_run_service()
        workflow_run = TestDataFactory.create_workflow_run()
        workflow = TestDataFactory.create_workflow(created_by="user-123")
        layer = PauseStatePersistenceLayer(
            workflow_run_service=workflow_run_service,
            workflow_run=workflow_run,
            workflow=workflow,
        )

        graph_runtime_state = MockReadOnlyGraphRuntimeState(
            outputs={"result": "test_output"},
            total_tokens=100,
        )
        command_channel = MockCommandChannel()
        layer.initialize(graph_runtime_state, command_channel)

        event = TestDataFactory.create_graph_run_paused_event(
            reason="User requested pause",
            outputs={"intermediate": "result"},
        )

        # Act
        layer.on_event(event)

        # Assert
        assert len(workflow_run_service.save_pause_state_calls) == 1
        call = workflow_run_service.save_pause_state_calls[0]
        assert call["workflow_run"] is workflow_run
        assert call["state_owner_user_id"] == "user-123"
        assert call["state"] == graph_runtime_state.dumps()

    def test_on_event_ignores_non_paused_events(self):
        """Test on_event method ignores events that are not GraphRunPausedEvent."""
        # Arrange
        workflow_run_service = create_mock_workflow_run_service()
        workflow_run = TestDataFactory.create_workflow_run()
        workflow = TestDataFactory.create_workflow()
        layer = PauseStatePersistenceLayer(
            workflow_run_service=workflow_run_service,
            workflow_run=workflow_run,
            workflow=workflow,
        )

        graph_runtime_state = MockReadOnlyGraphRuntimeState()
        command_channel = MockCommandChannel()
        layer.initialize(graph_runtime_state, command_channel)

        # Test different event types
        events = [
            TestDataFactory.create_graph_run_started_event(),
            TestDataFactory.create_graph_run_succeeded_event(),
            TestDataFactory.create_graph_run_failed_event(),
        ]

        # Act
        for event in events:
            layer.on_event(event)

        # Assert
        assert len(workflow_run_service.save_pause_state_calls) == 0

    def test_on_event_raises_assertion_when_graph_runtime_state_is_none(self):
        """Test on_event method raises AttributeError when graph_runtime_state is not set."""
        # Arrange
        workflow_run_service = create_mock_workflow_run_service()
        workflow_run = TestDataFactory.create_workflow_run()
        workflow = TestDataFactory.create_workflow()
        layer = PauseStatePersistenceLayer(
            workflow_run_service=workflow_run_service,
            workflow_run=workflow_run,
            workflow=workflow,
        )

        # Don't initialize - graph_runtime_state attribute doesn't exist
        event = TestDataFactory.create_graph_run_paused_event()

        # Act & Assert
        with pytest.raises(AttributeError):
            layer.on_event(event)

    def test_workflow_with_different_creator(self):
        """Test that workflow.created_by is correctly used as state_owner_user_id."""
        # Arrange
        workflow_run_service = create_mock_workflow_run_service()
        workflow_run = TestDataFactory.create_workflow_run()
        workflow = TestDataFactory.create_workflow(created_by="different-user-123")
        layer = PauseStatePersistenceLayer(
            workflow_run_service=workflow_run_service,
            workflow_run=workflow_run,
            workflow=workflow,
        )

        graph_runtime_state = MockReadOnlyGraphRuntimeState()
        command_channel = MockCommandChannel()
        layer.initialize(graph_runtime_state, command_channel)

        event = TestDataFactory.create_graph_run_paused_event()

        # Act
        layer.on_event(event)

        # Assert
        assert len(workflow_run_service.save_pause_state_calls) == 1
        call = workflow_run_service.save_pause_state_calls[0]
        assert call["state_owner_user_id"] == "different-user-123"
