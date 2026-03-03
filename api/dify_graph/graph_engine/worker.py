"""
Worker - Thread implementation for queue-based node execution

Workers pull node IDs from the ready_queue, execute nodes, and push events
to the event_queue for the dispatcher to process.
"""

import logging
import queue
import threading
import time
from collections.abc import Generator, Sequence
from datetime import datetime
from typing import TYPE_CHECKING, final

from typing_extensions import override

from dify_graph.context import IExecutionContext
from dify_graph.enums import NodeExecutionType, WorkflowNodeExecutionMetadataKey
from dify_graph.graph import Graph
from dify_graph.graph_engine.layers.base import GraphEngineLayer
from dify_graph.graph_engine.replay import (
    ExecutionStrategyDecision,
    NodeExecutionStrategyResolver,
    ReplayExecutionExecutor,
    normalize_execution_metadata,
)
from dify_graph.graph_events import (
    GraphNodeEventBase,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunRetryEvent,
    is_node_result_event,
)
from dify_graph.nodes.base.node import Node

from .ready_queue import ReadyQueue

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


@final
class Worker(threading.Thread):
    """
    Worker thread that executes nodes from the ready queue.

    Workers continuously pull node IDs from the ready_queue, execute the
    corresponding nodes, and push the resulting events to the event_queue
    for the dispatcher to process.
    """

    def __init__(
        self,
        ready_queue: ReadyQueue,
        event_queue: queue.Queue[GraphNodeEventBase],
        graph: Graph,
        layers: Sequence[GraphEngineLayer],
        worker_id: int = 0,
        execution_context: IExecutionContext | None = None,
        node_execution_strategy_resolver: NodeExecutionStrategyResolver | None = None,
        replay_execution_executor: ReplayExecutionExecutor | None = None,
    ) -> None:
        """
        Initialize worker thread.

        Args:
            ready_queue: Ready queue containing node IDs ready for execution
            event_queue: Queue for pushing execution events
            graph: Graph containing nodes to execute
            layers: Graph engine layers for node execution hooks
            worker_id: Unique identifier for this worker
            execution_context: Optional execution context for context preservation
        """
        super().__init__(name=f"GraphWorker-{worker_id}", daemon=True)
        self._ready_queue = ready_queue
        self._event_queue = event_queue
        self._graph = graph
        self._worker_id = worker_id
        self._execution_context = execution_context
        self._stop_event = threading.Event()
        self._layers = layers if layers is not None else []
        self._last_task_time = time.time()
        self._node_execution_strategy_resolver = node_execution_strategy_resolver
        self._replay_execution_executor = replay_execution_executor

    def stop(self) -> None:
        """Signal the worker to stop processing."""
        self._stop_event.set()

    @property
    def is_idle(self) -> bool:
        """Check if the worker is currently idle."""
        # Worker is idle if it hasn't processed a task recently (within 0.2 seconds)
        return (time.time() - self._last_task_time) > 0.2

    @property
    def idle_duration(self) -> float:
        """Get the duration in seconds since the worker last processed a task."""
        return time.time() - self._last_task_time

    @property
    def worker_id(self) -> int:
        """Get the worker's ID."""
        return self._worker_id

    @override
    def run(self) -> None:
        """
        Main worker loop.

        Continuously pulls node IDs from ready_queue, executes them,
        and pushes events to event_queue until stopped.
        """
        while not self._stop_event.is_set():
            # Try to get a node ID from the ready queue (with timeout)
            try:
                node_id = self._ready_queue.get(timeout=0.1)
            except queue.Empty:
                continue

            self._last_task_time = time.time()
            node = self._graph.nodes[node_id]
            try:
                self._execute_node(node)
                self._ready_queue.task_done()
            except Exception as e:
                error_event = NodeRunFailedEvent(
                    id=node.execution_id,
                    node_id=node.id,
                    node_type=node.node_type,
                    in_iteration_id=None,
                    error=str(e),
                    start_at=datetime.now(),
                )
                self._event_queue.put(error_event)

    def _execute_node(self, node: Node) -> None:
        """
        Execute a single node and handle its events.

        Args:
            node: The node instance to execute
        """
        node.ensure_execution_id()
        execution_decision = self._resolve_execution_strategy(node)
        self._log_execution_strategy(node=node, decision=execution_decision)

        error: Exception | None = None
        result_event: GraphNodeEventBase | None = None

        # Execute the node with preserved context if execution context is provided
        if self._execution_context is not None:
            with self._execution_context:
                self._invoke_node_run_start_hooks(node)
                try:
                    for event in self._run_node_events(node=node, decision=execution_decision):
                        self._event_queue.put(event)
                        if is_node_result_event(event):
                            result_event = event
                except Exception as exc:
                    error = exc
                    raise
                finally:
                    self._invoke_node_run_end_hooks(node, error, result_event)
        else:
            self._invoke_node_run_start_hooks(node)
            try:
                for event in self._run_node_events(node=node, decision=execution_decision):
                    self._event_queue.put(event)
                    if is_node_result_event(event):
                        result_event = event
            except Exception as exc:
                error = exc
                raise
            finally:
                self._invoke_node_run_end_hooks(node, error, result_event)

    def _run_node_events(
        self,
        *,
        node: Node,
        decision: ExecutionStrategyDecision,
    ) -> Generator[GraphNodeEventBase, None, None]:
        effective_decision = decision

        if effective_decision.mode == "replay":
            replay_snapshot = effective_decision.snapshot
            if replay_snapshot is not None and self._replay_execution_executor is not None:
                try:
                    replay_events = self._replay_execution_executor.execute(node=node, snapshot=replay_snapshot)
                    for event in replay_events:
                        self._inject_execution_metadata(event=event, decision=effective_decision)
                        yield event
                    return
                except Exception:
                    logger.exception(
                        "Replay node execution failed, fallback to real. node_id=%s execution_id=%s",
                        node.id,
                        node.execution_id,
                    )
                    effective_decision = ExecutionStrategyDecision.real(reason="replay_executor_failed")
            else:
                effective_decision = ExecutionStrategyDecision.real(reason="replay_executor_unavailable")

            self._log_execution_strategy(node=node, decision=effective_decision)

        for event in node.run():
            self._inject_execution_metadata(event=event, decision=effective_decision)
            yield event

    def _resolve_execution_strategy(self, node: Node) -> ExecutionStrategyDecision:
        resolver = self._node_execution_strategy_resolver
        if resolver is None:
            return ExecutionStrategyDecision.real()
        return resolver.resolve(node_id=node.id, is_branch_node=node.execution_type == NodeExecutionType.BRANCH)

    def _inject_execution_metadata(self, *, event: GraphNodeEventBase, decision: ExecutionStrategyDecision) -> None:
        if not (is_node_result_event(event) or isinstance(event, (NodeRunExceptionEvent, NodeRunRetryEvent))):
            return
        if self._node_execution_strategy_resolver is None:
            return

        metadata = normalize_execution_metadata(event.node_run_result.metadata)
        metadata[WorkflowNodeExecutionMetadataKey.EXECUTION_MODE] = decision.mode
        if decision.mode == "real" and decision.reason:
            metadata[WorkflowNodeExecutionMetadataKey.STRATEGY_REASON] = decision.reason

        if decision.mode == "replay" and decision.snapshot is not None:
            metadata[WorkflowNodeExecutionMetadataKey.SOURCE_WORKFLOW_RUN_ID] = decision.snapshot.source_workflow_run_id
            metadata[WorkflowNodeExecutionMetadataKey.SOURCE_NODE_EXECUTION_ID] = (
                decision.snapshot.source_node_execution_id
            )
            replay_edge_source_handle = decision.snapshot.resolved_edge_source_handle()
            if replay_edge_source_handle:
                metadata[WorkflowNodeExecutionMetadataKey.EDGE_SOURCE_HANDLE] = replay_edge_source_handle
                event.node_run_result.edge_source_handle = replay_edge_source_handle

        if event.node_run_result.edge_source_handle and event.node_run_result.edge_source_handle != "source":
            metadata.setdefault(
                WorkflowNodeExecutionMetadataKey.EDGE_SOURCE_HANDLE,
                event.node_run_result.edge_source_handle,
            )

        event.node_run_result.metadata = metadata

    @staticmethod
    def _log_execution_strategy(*, node: Node, decision: ExecutionStrategyDecision) -> None:
        if decision.mode == "real" and decision.reason is None:
            return

        source_workflow_run_id = decision.snapshot.source_workflow_run_id if decision.snapshot is not None else None
        source_node_execution_id = decision.snapshot.source_node_execution_id if decision.snapshot is not None else None
        logger.info(
            "Rerun node strategy node_id=%s execution_mode=%s strategy_reason=%s source_workflow_run_id=%s "
            "source_node_execution_id=%s",
            node.id,
            decision.mode,
            decision.reason,
            source_workflow_run_id,
            source_node_execution_id,
        )

    def _invoke_node_run_start_hooks(self, node: Node) -> None:
        """Invoke on_node_run_start hooks for all layers."""
        for layer in self._layers:
            try:
                layer.on_node_run_start(node)
            except Exception:
                # Silently ignore layer errors to prevent disrupting node execution
                continue

    def _invoke_node_run_end_hooks(
        self, node: Node, error: Exception | None, result_event: GraphNodeEventBase | None = None
    ) -> None:
        """Invoke on_node_run_end hooks for all layers."""
        for layer in self._layers:
            try:
                layer.on_node_run_end(node, error, result_event)
            except Exception:
                # Silently ignore layer errors to prevent disrupting node execution
                continue
