"""Tests for graph engine event handlers."""

from __future__ import annotations

from datetime import datetime

from core.workflow.entities import GraphRuntimeState, VariablePool
from core.workflow.enums import ErrorStrategy, NodeExecutionType, NodeState, NodeType, WorkflowNodeExecutionStatus
from core.workflow.graph import Graph
from core.workflow.graph_engine.domain.graph_execution import GraphExecution
from core.workflow.graph_engine.event_management.event_handlers import EventHandler
from core.workflow.graph_engine.event_management.event_manager import EventManager
from core.workflow.graph_engine.graph_state_manager import GraphStateManager
from core.workflow.graph_engine.ready_queue.in_memory import InMemoryReadyQueue
from core.workflow.graph_engine.response_coordinator.coordinator import ResponseStreamCoordinator
from core.workflow.graph_events import (
    GraphEngineEvent,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.entities import RetryConfig


class _StubEdgeProcessor:
    """Minimal edge processor stub for tests."""

    def process_node_success(self, node_id: str) -> tuple[list[str], list[GraphEngineEvent]]:
        return [], []

    def handle_branch_completion(
        self, node_id: str, edge_source_handle: str
    ) -> tuple[list[str], list[GraphEngineEvent]]:
        return [], []


class _StubErrorHandler:
    """Minimal error handler stub for tests."""

    def handle_node_failure(self, event: NodeRunFailedEvent):
        return None


class _StubCommandProcessor:
    """Tracks command processing invocations."""

    def __init__(self) -> None:
        self.calls = 0

    def process_commands(self) -> None:
        self.calls += 1


class _StubNode:
    """Simple node stub exposing the attributes needed by the state manager."""

    def __init__(self, node_id: str) -> None:
        self.id = node_id
        self.state = NodeState.UNKNOWN
        self.title = "Stub Node"
        self.execution_type = NodeExecutionType.EXECUTABLE
        self.error_strategy = ErrorStrategy.DEFAULT_VALUE
        self.retry_config = RetryConfig()
        self.retry = False


def _build_event_handler(
    node_id: str, *, command_processor: _StubCommandProcessor | None = None
) -> tuple[EventHandler, EventManager, GraphExecution, _StubCommandProcessor]:
    """Construct an EventHandler with in-memory dependencies for testing."""

    processor = command_processor or _StubCommandProcessor()

    node = _StubNode(node_id)
    graph = Graph(nodes={node_id: node}, edges={}, in_edges={}, out_edges={}, root_node=node)

    variable_pool = VariablePool()
    runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)
    graph_execution = GraphExecution(workflow_id="test-workflow")

    event_manager = EventManager()
    state_manager = GraphStateManager(graph=graph, ready_queue=InMemoryReadyQueue())
    response_coordinator = ResponseStreamCoordinator(variable_pool=variable_pool, graph=graph)

    handler = EventHandler(
        graph=graph,
        graph_runtime_state=runtime_state,
        graph_execution=graph_execution,
        response_coordinator=response_coordinator,
        event_collector=event_manager,
        edge_processor=_StubEdgeProcessor(),
        state_manager=state_manager,
        error_handler=_StubErrorHandler(),
        command_processor=processor,
    )

    return handler, event_manager, graph_execution, processor


def test_retry_does_not_emit_additional_start_event() -> None:
    """Ensure retry attempts do not produce duplicate start events."""

    node_id = "test-node"
    handler, event_manager, graph_execution, _ = _build_event_handler(node_id)

    execution_id = "exec-1"
    node_type = NodeType.CODE
    start_time = datetime.utcnow()

    start_event = NodeRunStartedEvent(
        id=execution_id,
        node_id=node_id,
        node_type=node_type,
        node_title="Stub Node",
        start_at=start_time,
    )
    handler.dispatch(start_event)

    retry_event = NodeRunRetryEvent(
        id=execution_id,
        node_id=node_id,
        node_type=node_type,
        node_title="Stub Node",
        start_at=start_time,
        error="boom",
        retry_index=1,
        node_run_result=NodeRunResult(
            status=WorkflowNodeExecutionStatus.FAILED,
            error="boom",
            error_type="TestError",
        ),
    )
    handler.dispatch(retry_event)

    # Simulate the node starting execution again after retry
    second_start_event = NodeRunStartedEvent(
        id=execution_id,
        node_id=node_id,
        node_type=node_type,
        node_title="Stub Node",
        start_at=start_time,
    )
    handler.dispatch(second_start_event)

    collected_types = [type(event) for event in event_manager._events]  # type: ignore[attr-defined]

    assert collected_types == [NodeRunStartedEvent, NodeRunRetryEvent]

    node_execution = graph_execution.get_or_create_node_execution(node_id)
    assert node_execution.retry_count == 1


def test_success_event_triggers_command_check() -> None:
    """Node success should trigger an immediate command check."""

    node_id = "node-success"
    handler, _, _, processor = _build_event_handler(node_id)

    success_event = NodeRunSucceededEvent(
        id="exec-success",
        node_id=node_id,
        node_type=NodeType.CODE,
        node_title="Stub Node",
        start_at=datetime.utcnow(),
        node_run_result=NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            outputs={"answer": "done"},
        ),
    )

    handler.dispatch(success_event)

    assert processor.calls == 1


def test_failure_event_triggers_command_check() -> None:
    """Node failure without retry should trigger a command check."""

    node_id = "node-failure"
    handler, _, graph_execution, processor = _build_event_handler(node_id)

    start_event = NodeRunStartedEvent(
        id="exec-failure",
        node_id=node_id,
        node_type=NodeType.CODE,
        node_title="Stub Node",
        start_at=datetime.utcnow(),
    )
    handler.dispatch(start_event)

    failure_event = NodeRunFailedEvent(
        id="exec-failure",
        node_id=node_id,
        node_type=NodeType.CODE,
        node_title="Stub Node",
        start_at=datetime.utcnow(),
        error="boom",
        node_run_result=NodeRunResult(
            status=WorkflowNodeExecutionStatus.FAILED,
            error="boom",
            error_type="TestError",
        ),
    )
    handler.dispatch(failure_event)

    assert processor.calls == 1
    assert graph_execution.has_error


def test_exception_event_triggers_command_check() -> None:
    """Fail-branch completions should trigger a command check."""

    node_id = "node-exception"
    handler, _, _, processor = _build_event_handler(node_id)

    exception_event = NodeRunExceptionEvent(
        id="exec-exception",
        node_id=node_id,
        node_type=NodeType.CODE,
        node_title="Stub Node",
        start_at=datetime.utcnow(),
        error="handled",
        node_run_result=NodeRunResult(
            status=WorkflowNodeExecutionStatus.FAILED,
            outputs={"fallback": "value"},
        ),
    )

    handler.dispatch(exception_event)

    assert processor.calls == 1
