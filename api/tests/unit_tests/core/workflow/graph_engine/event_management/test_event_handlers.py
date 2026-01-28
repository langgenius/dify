"""Tests for graph engine event handlers."""

from __future__ import annotations

from core.workflow.enums import (
    ErrorStrategy,
    NodeExecutionType,
    NodeState,
    NodeType,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.graph import Graph
from core.workflow.graph_engine.domain.graph_execution import GraphExecution
from core.workflow.graph_engine.event_management.event_handlers import EventHandler
from core.workflow.graph_engine.event_management.event_manager import EventManager
from core.workflow.graph_engine.graph_state_manager import GraphStateManager
from core.workflow.graph_engine.ready_queue.in_memory import InMemoryReadyQueue
from core.workflow.graph_engine.response_coordinator.coordinator import ResponseStreamCoordinator
from core.workflow.graph_events import NodeRunExceptionEvent, NodeRunRetryEvent, NodeRunStartedEvent
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


class _StubLLMNodeWithFallback:
    """LLM node stub with fallback model strategy for testing."""

    def __init__(self, node_id: str) -> None:
        self.id = node_id
        self.state = NodeState.UNKNOWN
        self.title = "LLM Node with Fallback"
        self.execution_type = NodeExecutionType.EXECUTABLE
        self.error_strategy = ErrorStrategy.FALLBACK_MODEL
        self.retry_config = RetryConfig()
        self.retry = False
        self.node_type = NodeType.LLM


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


def _build_event_handler_with_fallback_node(
    node_id: str,
) -> tuple[EventHandler, EventManager, GraphExecution, GraphStateManager, GraphRuntimeState]:
    """Construct an EventHandler with a fallback model node for testing."""

    node = _StubLLMNodeWithFallback(node_id)
    graph = Graph(nodes={node_id: node}, edges={}, in_edges={}, out_edges={}, root_node=node)

    variable_pool = VariablePool()
    runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)
    graph_execution = GraphExecution(workflow_id="test-workflow")

    event_manager = EventManager()
    ready_queue = InMemoryReadyQueue()
    state_manager = GraphStateManager(graph=graph, ready_queue=ready_queue)
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

    return handler, event_manager, graph_execution, state_manager, runtime_state


def test_fallback_model_exception_event_requeues_node() -> None:
    """Test that FALLBACK_MODEL strategy requeues node for execution with fallback model."""

    node_id = "llm-node-1"
    handler, event_manager, graph_execution, state_manager, runtime_state = _build_event_handler_with_fallback_node(
        node_id
    )

    execution_id = "exec-1"
    start_time = naive_utc_now()

    # Create a NodeRunExceptionEvent with FALLBACK_MODEL metadata
    exception_event = NodeRunExceptionEvent(
        id=execution_id,
        node_id=node_id,
        node_type=NodeType.LLM,
        start_at=start_time,
        error="Primary model failed",
        node_run_result=NodeRunResult(
            status=WorkflowNodeExecutionStatus.EXCEPTION,
            error="Primary model failed",
            error_type="ModelInvokeError",
            metadata={
                WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX: 0,
                WorkflowNodeExecutionMetadataKey.ERROR_STRATEGY: ErrorStrategy.FALLBACK_MODEL,
            },
        ),
    )

    # Dispatch the exception event
    handler.dispatch(exception_event)

    # Verify the exception event was collected
    collected_events = list(event_manager._events)  # type: ignore[attr-defined]
    assert len(collected_events) == 1
    assert isinstance(collected_events[0], NodeRunExceptionEvent)
    assert collected_events[0].node_id == node_id

    # Verify the node was requeued in the ready queue
    assert state_manager._ready_queue.qsize() == 1


def test_fallback_model_exception_event_accumulates_usage() -> None:
    """Test that FALLBACK_MODEL strategy accumulates LLM usage from failed attempts."""
    from decimal import Decimal

    from core.model_runtime.entities.llm_entities import LLMUsage

    node_id = "llm-node-1"
    handler, event_manager, graph_execution, state_manager, runtime_state = _build_event_handler_with_fallback_node(
        node_id
    )

    execution_id = "exec-1"
    start_time = naive_utc_now()

    # Create usage for the failed attempt
    failed_usage = LLMUsage(
        prompt_tokens=100,
        prompt_unit_price=Decimal("0.001"),
        prompt_price_unit=Decimal(1000),
        prompt_price=Decimal("0.0001"),
        completion_tokens=50,
        completion_unit_price=Decimal("0.002"),
        completion_price_unit=Decimal(1000),
        completion_price=Decimal("0.0001"),
        total_tokens=150,
        total_price=Decimal("0.0002"),
        currency="USD",
        latency=0.5,
    )

    exception_event = NodeRunExceptionEvent(
        id=execution_id,
        node_id=node_id,
        node_type=NodeType.LLM,
        start_at=start_time,
        error="Primary model failed",
        node_run_result=NodeRunResult(
            status=WorkflowNodeExecutionStatus.EXCEPTION,
            error="Primary model failed",
            error_type="ModelInvokeError",
            metadata={
                WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX: 0,
                WorkflowNodeExecutionMetadataKey.ERROR_STRATEGY: ErrorStrategy.FALLBACK_MODEL,
            },
            llm_usage=failed_usage,
        ),
    )

    # Dispatch the exception event
    handler.dispatch(exception_event)

    # Verify LLM usage was accumulated
    assert runtime_state.llm_usage.total_tokens == 150
    assert runtime_state.total_tokens == 150


def test_fallback_model_exception_event_collects_event_for_observers() -> None:
    """Test that FALLBACK_MODEL strategy collects exception event for SSE streaming."""

    node_id = "llm-node-1"
    handler, event_manager, graph_execution, state_manager, runtime_state = _build_event_handler_with_fallback_node(
        node_id
    )

    execution_id = "exec-1"
    start_time = naive_utc_now()

    exception_event = NodeRunExceptionEvent(
        id=execution_id,
        node_id=node_id,
        node_type=NodeType.LLM,
        start_at=start_time,
        error="Primary model failed",
        node_run_result=NodeRunResult(
            status=WorkflowNodeExecutionStatus.EXCEPTION,
            error="Primary model failed",
            error_type="ModelInvokeError",
            metadata={
                WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX: 0,
                WorkflowNodeExecutionMetadataKey.ERROR_STRATEGY: ErrorStrategy.FALLBACK_MODEL,
            },
        ),
    )

    handler.dispatch(exception_event)

    # Verify the event was collected (for SSE node_finished with exception status)
    collected_events = list(event_manager._events)  # type: ignore[attr-defined]
    assert len(collected_events) == 1
    assert collected_events[0].error == "Primary model failed"
    assert collected_events[0].node_run_result.metadata[WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX] == 0
