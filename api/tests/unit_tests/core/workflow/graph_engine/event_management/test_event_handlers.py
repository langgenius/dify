"""Tests for graph engine event handlers."""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from core.workflow.enums import NodeExecutionType, NodeState, NodeType, WorkflowNodeExecutionStatus
from core.workflow.graph import Graph
from core.workflow.graph_engine.domain.graph_execution import GraphExecution
from core.workflow.graph_engine.event_management.event_handlers import EventHandler
from core.workflow.graph_engine.event_management.event_manager import EventManager
from core.workflow.graph_engine.graph_state_manager import GraphStateManager
from core.workflow.graph_engine.ready_queue.in_memory import InMemoryReadyQueue
from core.workflow.graph_engine.response_coordinator.coordinator import ResponseStreamCoordinator
from core.workflow.graph_events import NodeRunRetryEvent, NodeRunStartedEvent
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.entities import RetryConfig
from core.workflow.runtime import GraphRuntimeState, VariablePool
from libs.datetime_utils import naive_utc_now


class _StubEdgeProcessor:
    """Minimal edge processor stub for tests."""


class _StubErrorHandler:
    """Minimal error handler stub for tests."""


class _StubNode:
    """Simple node stub exposing the attributes needed by the state manager."""

    def __init__(self, node_id: str) -> None:
        self.id = node_id
        self.state = NodeState.UNKNOWN
        self.title = "Stub Node"
        self.execution_type = NodeExecutionType.EXECUTABLE
        self.error_strategy = None
        self.retry_config = RetryConfig()
        self.retry = False


def _build_event_handler(node_id: str) -> tuple[EventHandler, EventManager, GraphExecution]:
    """Construct an EventHandler with in-memory dependencies for testing."""

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
    )

    return handler, event_manager, graph_execution


def test_retry_does_not_emit_additional_start_event() -> None:
    """Ensure retry attempts do not produce duplicate start events."""

    node_id = "test-node"
    handler, event_manager, graph_execution = _build_event_handler(node_id)

    execution_id = "exec-1"
    node_type = NodeType.CODE
    start_time = naive_utc_now()

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


@dataclass(frozen=True)
class _ResumptionFlagCase:
    node_id: str
    execution_id: str
    node_title: str
    is_resumption: bool


@pytest.mark.parametrize(
    "case",
    [
        _ResumptionFlagCase(
            node_id="resumed-node",
            execution_id="exec-1",
            node_title="Resumed Node",
            is_resumption=True,
        ),
        _ResumptionFlagCase(
            node_id="fresh-node",
            execution_id="exec-2",
            node_title="Fresh Node",
            is_resumption=False,
        ),
    ],
)
def test_node_start_preserves_resumption_flag(case: _ResumptionFlagCase) -> None:
    """Ensure NodeRunStartedEvent preserves resumption flag."""

    handler, event_manager, _ = _build_event_handler(case.node_id)

    start_event = NodeRunStartedEvent(
        id=case.execution_id,
        node_id=case.node_id,
        node_type=NodeType.CODE,
        node_title=case.node_title,
        start_at=naive_utc_now(),
        is_resumption=case.is_resumption,
    )
    handler.dispatch(start_event)

    collected = event_manager._events  # type: ignore[attr-defined]
    assert len(collected) == 1
    emitted_event = collected[0]
    assert isinstance(emitted_event, NodeRunStartedEvent)
    assert emitted_event.is_resumption is case.is_resumption


def test_node_start_marks_fresh_run_as_not_resumption() -> None:
    """Ensure fresh NodeRunStartedEvent carries is_resumption=False."""

    node_id = "fresh-node"
    handler, event_manager, _ = _build_event_handler(node_id)

    start_event = NodeRunStartedEvent(
        id="exec-2",
        node_id=node_id,
        node_type=NodeType.CODE,
        node_title="Fresh Node",
        start_at=naive_utc_now(),
    )
    handler.dispatch(start_event)

    collected = event_manager._events  # type: ignore[attr-defined]
    assert len(collected) == 1
    emitted_event = collected[0]
    assert isinstance(emitted_event, NodeRunStartedEvent)
    assert emitted_event.is_resumption is False
