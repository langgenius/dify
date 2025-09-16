"""Unit tests for GraphExecution serialization helpers."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

from core.workflow.entities import GraphRuntimeState
from core.workflow.enums import NodeExecutionType, NodeState
from core.workflow.graph_engine import GraphEngine
from core.workflow.graph_engine.domain import GraphExecution


class CustomGraphExecutionError(Exception):
    """Custom exception used to verify error serialization."""


def test_graph_execution_serialization_round_trip() -> None:
    """GraphExecution serialization restores full aggregate state."""
    # Arrange
    execution = GraphExecution(workflow_id="wf-1")
    execution.start()
    node_a = execution.get_or_create_node_execution("node-a")
    node_a.mark_started(execution_id="exec-1")
    node_a.increment_retry()
    node_a.mark_failed("boom")
    node_b = execution.get_or_create_node_execution("node-b")
    node_b.mark_skipped()
    execution.fail(CustomGraphExecutionError("serialization failure"))

    # Act
    serialized = execution.dumps()
    payload = json.loads(serialized)
    restored = GraphExecution(workflow_id="wf-1")
    restored.loads(serialized)

    # Assert
    assert payload["type"] == "GraphExecution"
    assert payload["version"] == "1.0"
    assert restored.workflow_id == "wf-1"
    assert restored.started is True
    assert restored.completed is True
    assert restored.aborted is False
    assert isinstance(restored.error, CustomGraphExecutionError)
    assert str(restored.error) == "serialization failure"
    assert set(restored.node_executions) == {"node-a", "node-b"}
    restored_node_a = restored.node_executions["node-a"]
    assert restored_node_a.state is NodeState.TAKEN
    assert restored_node_a.retry_count == 1
    assert restored_node_a.execution_id == "exec-1"
    assert restored_node_a.error == "boom"
    restored_node_b = restored.node_executions["node-b"]
    assert restored_node_b.state is NodeState.SKIPPED
    assert restored_node_b.retry_count == 0
    assert restored_node_b.execution_id is None
    assert restored_node_b.error is None


def test_graph_execution_loads_replaces_existing_state() -> None:
    """loads replaces existing runtime data with serialized snapshot."""
    # Arrange
    source = GraphExecution(workflow_id="wf-2")
    source.start()
    source_node = source.get_or_create_node_execution("node-source")
    source_node.mark_taken()
    serialized = source.dumps()

    target = GraphExecution(workflow_id="wf-2")
    target.start()
    target.abort("pre-existing abort")
    temp_node = target.get_or_create_node_execution("node-temp")
    temp_node.increment_retry()
    temp_node.mark_failed("temp error")

    # Act
    target.loads(serialized)

    # Assert
    assert target.aborted is False
    assert target.error is None
    assert target.started is True
    assert target.completed is False
    assert set(target.node_executions) == {"node-source"}
    restored_node = target.node_executions["node-source"]
    assert restored_node.state is NodeState.TAKEN
    assert restored_node.retry_count == 0
    assert restored_node.execution_id is None
    assert restored_node.error is None


def test_graph_engine_initializes_from_serialized_execution(monkeypatch) -> None:
    """GraphEngine restores GraphExecution state from runtime snapshot on init."""

    # Arrange serialized execution state
    execution = GraphExecution(workflow_id="wf-init")
    execution.start()
    node_state = execution.get_or_create_node_execution("serialized-node")
    node_state.mark_taken()
    execution.complete()
    serialized = execution.dumps()

    runtime_state = GraphRuntimeState(
        variable_pool=MagicMock(),
        start_at=0.0,
        graph_execution_json=serialized,
    )

    class DummyNode:
        def __init__(self, graph_runtime_state: GraphRuntimeState) -> None:
            self.graph_runtime_state = graph_runtime_state
            self.execution_type = NodeExecutionType.EXECUTABLE
            self.id = "dummy-node"
            self.state = NodeState.UNKNOWN
            self.title = "dummy"

    class DummyGraph:
        def __init__(self, graph_runtime_state: GraphRuntimeState) -> None:
            self.nodes = {"dummy-node": DummyNode(graph_runtime_state)}
            self.edges: dict[str, object] = {}
            self.root_node = self.nodes["dummy-node"]

        def get_incoming_edges(self, node_id: str):  # pragma: no cover - not exercised
            return []

        def get_outgoing_edges(self, node_id: str):  # pragma: no cover - not exercised
            return []

    dummy_graph = DummyGraph(runtime_state)

    def _stub(*_args, **_kwargs):
        return MagicMock()

    monkeypatch.setattr("core.workflow.graph_engine.graph_engine.GraphStateManager", _stub)
    monkeypatch.setattr("core.workflow.graph_engine.graph_engine.ResponseStreamCoordinator", _stub)
    monkeypatch.setattr("core.workflow.graph_engine.graph_engine.EventManager", _stub)
    monkeypatch.setattr("core.workflow.graph_engine.graph_engine.ErrorHandler", _stub)
    monkeypatch.setattr("core.workflow.graph_engine.graph_engine.SkipPropagator", _stub)
    monkeypatch.setattr("core.workflow.graph_engine.graph_engine.EdgeProcessor", _stub)
    monkeypatch.setattr("core.workflow.graph_engine.graph_engine.EventHandler", _stub)
    command_processor = MagicMock()
    command_processor.register_handler = MagicMock()
    monkeypatch.setattr(
        "core.workflow.graph_engine.graph_engine.CommandProcessor",
        lambda *_args, **_kwargs: command_processor,
    )
    monkeypatch.setattr("core.workflow.graph_engine.graph_engine.AbortCommandHandler", _stub)
    monkeypatch.setattr("core.workflow.graph_engine.graph_engine.WorkerPool", _stub)
    monkeypatch.setattr("core.workflow.graph_engine.graph_engine.ExecutionCoordinator", _stub)
    monkeypatch.setattr("core.workflow.graph_engine.graph_engine.Dispatcher", _stub)

    # Act
    engine = GraphEngine(
        workflow_id="wf-init",
        graph=dummy_graph,  # type: ignore[arg-type]
        graph_runtime_state=runtime_state,
        command_channel=MagicMock(),
    )

    # Assert
    assert engine._graph_execution.started is True
    assert engine._graph_execution.completed is True
    assert set(engine._graph_execution.node_executions) == {"serialized-node"}
    restored_node = engine._graph_execution.node_executions["serialized-node"]
    assert restored_node.state is NodeState.TAKEN
    assert restored_node.retry_count == 0
