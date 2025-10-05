"""Unit tests for GraphExecution serialization helpers."""

from __future__ import annotations

import json
from collections import deque
from unittest.mock import MagicMock

from core.workflow.enums import NodeExecutionType, NodeState, NodeType
from core.workflow.graph_engine.domain import GraphExecution
from core.workflow.graph_engine.response_coordinator import ResponseStreamCoordinator
from core.workflow.graph_engine.response_coordinator.path import Path
from core.workflow.graph_engine.response_coordinator.session import ResponseSession
from core.workflow.graph_events import NodeRunStreamChunkEvent
from core.workflow.nodes.base.template import Template, TextSegment, VariableSegment


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


def test_response_stream_coordinator_serialization_round_trip(monkeypatch) -> None:
    """ResponseStreamCoordinator serialization restores coordinator internals."""

    template_main = Template(segments=[TextSegment(text="Hi "), VariableSegment(selector=["node-source", "text"])])
    template_secondary = Template(segments=[TextSegment(text="secondary")])

    class DummyNode:
        def __init__(self, node_id: str, template: Template, execution_type: NodeExecutionType) -> None:
            self.id = node_id
            self.node_type = NodeType.ANSWER if execution_type == NodeExecutionType.RESPONSE else NodeType.LLM
            self.execution_type = execution_type
            self.state = NodeState.UNKNOWN
            self.title = node_id
            self.template = template

        def blocks_variable_output(self, *_args) -> bool:
            return False

    response_node1 = DummyNode("response-1", template_main, NodeExecutionType.RESPONSE)
    response_node2 = DummyNode("response-2", template_main, NodeExecutionType.RESPONSE)
    response_node3 = DummyNode("response-3", template_main, NodeExecutionType.RESPONSE)
    source_node = DummyNode("node-source", template_secondary, NodeExecutionType.EXECUTABLE)

    class DummyGraph:
        def __init__(self) -> None:
            self.nodes = {
                response_node1.id: response_node1,
                response_node2.id: response_node2,
                response_node3.id: response_node3,
                source_node.id: source_node,
            }
            self.edges: dict[str, object] = {}
            self.root_node = response_node1

        def get_outgoing_edges(self, _node_id: str):  # pragma: no cover - not exercised
            return []

        def get_incoming_edges(self, _node_id: str):  # pragma: no cover - not exercised
            return []

    graph = DummyGraph()

    def fake_from_node(cls, node: DummyNode) -> ResponseSession:
        return ResponseSession(node_id=node.id, template=node.template)

    monkeypatch.setattr(ResponseSession, "from_node", classmethod(fake_from_node))

    coordinator = ResponseStreamCoordinator(variable_pool=MagicMock(), graph=graph)  # type: ignore[arg-type]
    coordinator._response_nodes = {"response-1", "response-2", "response-3"}
    coordinator._paths_maps = {
        "response-1": [Path(edges=["edge-1"])],
        "response-2": [Path(edges=[])],
        "response-3": [Path(edges=["edge-2", "edge-3"])],
    }

    active_session = ResponseSession(node_id="response-1", template=response_node1.template)
    active_session.index = 1
    coordinator._active_session = active_session
    waiting_session = ResponseSession(node_id="response-2", template=response_node2.template)
    coordinator._waiting_sessions = deque([waiting_session])
    pending_session = ResponseSession(node_id="response-3", template=response_node3.template)
    pending_session.index = 2
    coordinator._response_sessions = {"response-3": pending_session}

    coordinator._node_execution_ids = {"response-1": "exec-1"}
    event = NodeRunStreamChunkEvent(
        id="exec-1",
        node_id="response-1",
        node_type=NodeType.ANSWER,
        selector=["node-source", "text"],
        chunk="chunk-1",
        is_final=False,
    )
    coordinator._stream_buffers = {("node-source", "text"): [event]}
    coordinator._stream_positions = {("node-source", "text"): 1}
    coordinator._closed_streams = {("node-source", "text")}

    serialized = coordinator.dumps()

    restored = ResponseStreamCoordinator(variable_pool=MagicMock(), graph=graph)  # type: ignore[arg-type]
    monkeypatch.setattr(ResponseSession, "from_node", classmethod(fake_from_node))
    restored.loads(serialized)

    assert restored._response_nodes == {"response-1", "response-2", "response-3"}
    assert restored._paths_maps["response-1"][0].edges == ["edge-1"]
    assert restored._active_session is not None
    assert restored._active_session.node_id == "response-1"
    assert restored._active_session.index == 1
    waiting_restored = list(restored._waiting_sessions)
    assert len(waiting_restored) == 1
    assert waiting_restored[0].node_id == "response-2"
    assert waiting_restored[0].index == 0
    assert set(restored._response_sessions) == {"response-3"}
    assert restored._response_sessions["response-3"].index == 2
    assert restored._node_execution_ids == {"response-1": "exec-1"}
    assert ("node-source", "text") in restored._stream_buffers
    restored_event = restored._stream_buffers[("node-source", "text")][0]
    assert restored_event.chunk == "chunk-1"
    assert restored._stream_positions[("node-source", "text")] == 1
    assert ("node-source", "text") in restored._closed_streams
