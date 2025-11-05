import json
from time import time
from unittest.mock import Mock

import pytest

from core.app.layers.pause_state_persist_layer import PauseStatePersistenceLayer
from core.variables.segments import Segment
from core.workflow.entities.pause_reason import SchedulingPause
from core.workflow.graph_engine.entities.commands import GraphEngineCommand
from core.workflow.graph_events.graph import (
    GraphRunFailedEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
)
from core.workflow.runtime.graph_runtime_state_protocol import ReadOnlyVariablePool
from repositories.factory import DifyAPIRepositoryFactory


class TestDataFactory:
    """Factory helpers for constructing graph events used in tests."""

    @staticmethod
    def create_graph_run_paused_event(outputs: dict[str, object] | None = None) -> GraphRunPausedEvent:
        return GraphRunPausedEvent(reason=SchedulingPause(message="test pause"), outputs=outputs or {})

    @staticmethod
    def create_graph_run_started_event() -> GraphRunStartedEvent:
        return GraphRunStartedEvent()

    @staticmethod
    def create_graph_run_succeeded_event(outputs: dict[str, object] | None = None) -> GraphRunSucceededEvent:
        return GraphRunSucceededEvent(outputs=outputs or {})

    @staticmethod
    def create_graph_run_failed_event(
        error: str = "Test error",
        exceptions_count: int = 1,
    ) -> GraphRunFailedEvent:
        return GraphRunFailedEvent(error=error, exceptions_count=exceptions_count)


class MockSystemVariableReadOnlyView:
    """Minimal read-only system variable view for testing."""

    def __init__(self, workflow_execution_id: str | None = None) -> None:
        self._workflow_execution_id = workflow_execution_id

    @property
    def workflow_execution_id(self) -> str | None:
        return self._workflow_execution_id


class MockReadOnlyVariablePool:
    """Mock implementation of ReadOnlyVariablePool for testing."""

    def __init__(self, variables: dict[tuple[str, str], object] | None = None):
        self._variables = variables or {}

    def get(self, node_id: str, variable_key: str) -> Segment | None:
        value = self._variables.get((node_id, variable_key))
        if value is None:
            return None
        mock_segment = Mock(spec=Segment)
        mock_segment.value = value
        return mock_segment

    def get_all_by_node(self, node_id: str) -> dict[str, object]:
        return {key: value for (nid, key), value in self._variables.items() if nid == node_id}

    def get_by_prefix(self, prefix: str) -> dict[str, object]:
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
        workflow_execution_id: str | None = None,
    ):
        self._start_at = start_at or time()
        self._total_tokens = total_tokens
        self._node_run_steps = node_run_steps
        self._ready_queue_size = ready_queue_size
        self._exceptions_count = exceptions_count
        self._outputs = outputs or {}
        self._variable_pool = MockReadOnlyVariablePool(variables)
        self._system_variable = MockSystemVariableReadOnlyView(workflow_execution_id)

    @property
    def system_variable(self) -> MockSystemVariableReadOnlyView:
        return self._system_variable

    @property
    def variable_pool(self) -> ReadOnlyVariablePool:
        return self._variable_pool

    @property
    def start_at(self) -> float:
        return self._start_at

    @property
    def total_tokens(self) -> int:
        return self._total_tokens

    @property
    def node_run_steps(self) -> int:
        return self._node_run_steps

    @property
    def ready_queue_size(self) -> int:
        return self._ready_queue_size

    @property
    def exceptions_count(self) -> int:
        return self._exceptions_count

    @property
    def outputs(self) -> dict[str, object]:
        return self._outputs.copy()

    @property
    def llm_usage(self):
        mock_usage = Mock()
        mock_usage.prompt_tokens = 10
        mock_usage.completion_tokens = 20
        mock_usage.total_tokens = 30
        return mock_usage

    def get_output(self, key: str, default: object = None) -> object:
        return self._outputs.get(key, default)

    def dumps(self) -> str:
        return json.dumps(
            {
                "start_at": self._start_at,
                "total_tokens": self._total_tokens,
                "node_run_steps": self._node_run_steps,
                "ready_queue_size": self._ready_queue_size,
                "exceptions_count": self._exceptions_count,
                "outputs": self._outputs,
                "variables": {f"{k[0]}.{k[1]}": v for k, v in self._variable_pool._variables.items()},
                "workflow_execution_id": self._system_variable.workflow_execution_id,
            }
        )


class MockCommandChannel:
    """Mock implementation of CommandChannel for testing."""

    def __init__(self):
        self._commands: list[GraphEngineCommand] = []

    def fetch_commands(self) -> list[GraphEngineCommand]:
        return self._commands.copy()

    def send_command(self, command: GraphEngineCommand) -> None:
        self._commands.append(command)


class TestPauseStatePersistenceLayer:
    """Unit tests for PauseStatePersistenceLayer."""

    def test_init_with_dependency_injection(self):
        session_factory = Mock(name="session_factory")
        state_owner_user_id = "user-123"

        layer = PauseStatePersistenceLayer(
            session_factory=session_factory,
            state_owner_user_id=state_owner_user_id,
        )

        assert layer._session_maker is session_factory
        assert layer._state_owner_user_id == state_owner_user_id
        assert not hasattr(layer, "graph_runtime_state")
        assert not hasattr(layer, "command_channel")

    def test_initialize_sets_dependencies(self):
        session_factory = Mock(name="session_factory")
        layer = PauseStatePersistenceLayer(session_factory=session_factory, state_owner_user_id="owner")

        graph_runtime_state = MockReadOnlyGraphRuntimeState()
        command_channel = MockCommandChannel()

        layer.initialize(graph_runtime_state, command_channel)

        assert layer.graph_runtime_state is graph_runtime_state
        assert layer.command_channel is command_channel

    def test_on_event_with_graph_run_paused_event(self, monkeypatch: pytest.MonkeyPatch):
        session_factory = Mock(name="session_factory")
        layer = PauseStatePersistenceLayer(session_factory=session_factory, state_owner_user_id="owner-123")

        mock_repo = Mock()
        mock_factory = Mock(return_value=mock_repo)
        monkeypatch.setattr(DifyAPIRepositoryFactory, "create_api_workflow_run_repository", mock_factory)

        graph_runtime_state = MockReadOnlyGraphRuntimeState(
            outputs={"result": "test_output"},
            total_tokens=100,
            workflow_execution_id="run-123",
        )
        command_channel = MockCommandChannel()
        layer.initialize(graph_runtime_state, command_channel)

        event = TestDataFactory.create_graph_run_paused_event(outputs={"intermediate": "result"})
        expected_state = graph_runtime_state.dumps()

        layer.on_event(event)

        mock_factory.assert_called_once_with(session_factory)
        mock_repo.create_workflow_pause.assert_called_once_with(
            workflow_run_id="run-123",
            state_owner_user_id="owner-123",
            state=expected_state,
        )

    def test_on_event_ignores_non_paused_events(self, monkeypatch: pytest.MonkeyPatch):
        session_factory = Mock(name="session_factory")
        layer = PauseStatePersistenceLayer(session_factory=session_factory, state_owner_user_id="owner-123")

        mock_repo = Mock()
        mock_factory = Mock(return_value=mock_repo)
        monkeypatch.setattr(DifyAPIRepositoryFactory, "create_api_workflow_run_repository", mock_factory)

        graph_runtime_state = MockReadOnlyGraphRuntimeState()
        command_channel = MockCommandChannel()
        layer.initialize(graph_runtime_state, command_channel)

        events = [
            TestDataFactory.create_graph_run_started_event(),
            TestDataFactory.create_graph_run_succeeded_event(),
            TestDataFactory.create_graph_run_failed_event(),
        ]

        for event in events:
            layer.on_event(event)

        mock_factory.assert_not_called()
        mock_repo.create_workflow_pause.assert_not_called()

    def test_on_event_raises_attribute_error_when_graph_runtime_state_is_none(self):
        session_factory = Mock(name="session_factory")
        layer = PauseStatePersistenceLayer(session_factory=session_factory, state_owner_user_id="owner-123")

        event = TestDataFactory.create_graph_run_paused_event()

        with pytest.raises(AttributeError):
            layer.on_event(event)

    def test_on_event_asserts_when_workflow_execution_id_missing(self, monkeypatch: pytest.MonkeyPatch):
        session_factory = Mock(name="session_factory")
        layer = PauseStatePersistenceLayer(session_factory=session_factory, state_owner_user_id="owner-123")

        mock_repo = Mock()
        mock_factory = Mock(return_value=mock_repo)
        monkeypatch.setattr(DifyAPIRepositoryFactory, "create_api_workflow_run_repository", mock_factory)

        graph_runtime_state = MockReadOnlyGraphRuntimeState(workflow_execution_id=None)
        command_channel = MockCommandChannel()
        layer.initialize(graph_runtime_state, command_channel)

        event = TestDataFactory.create_graph_run_paused_event()

        with pytest.raises(AssertionError):
            layer.on_event(event)

        mock_factory.assert_not_called()
        mock_repo.create_workflow_pause.assert_not_called()
