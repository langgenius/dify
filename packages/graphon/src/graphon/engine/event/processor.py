"""Apply node events to execution state."""

import logging
from collections.abc import Iterator, Mapping
from functools import singledispatchmethod
from typing import final

from graphon.engine_events.agent import NodeRunAgentLogEvent
from graphon.engine_events.base import NodeEvent
from graphon.engine_events.iteration import (
    NodeRunIterationFailedEvent,
    NodeRunIterationNextEvent,
    NodeRunIterationStartedEvent,
    NodeRunIterationSucceededEvent,
)
from graphon.engine_events.loop import (
    NodeRunLoopFailedEvent,
    NodeRunLoopNextEvent,
    NodeRunLoopStartedEvent,
    NodeRunLoopSucceededEvent,
)
from graphon.engine_events.node import (
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunModelPollingProgressEvent,
    NodeRunPauseRequestedEvent,
    NodeRunReasoningChunkEvent,
    NodeRunRetrieverResourceEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
    NodeRunVariableUpdatedEvent,
)
from graphon.enums import (
    BuiltinNodeTypes,
    ErrorStrategy,
    NodeExecutionType,
    NodeState,
    NodeType,
    WorkflowNodeExecutionStatus,
)
from graphon.nodes.container_effects import (
    ContainerExecutionResult,
    ContainerNodeRunResult,
)
from graphon.runtime.execution import ROOT_FRAME_ID, GraphExecution
from graphon.runtime.ready_queue import ResumeTask, StartTask
from graphon.variables.segments import Segment

from ..container_handler import ContainerHandler
from ..frame import ExecutionFrame, FrameRegistry
from ..worker import ContainerAwaitTask, NodeEventTask
from .stream import EventStream

logger = logging.getLogger(__name__)


@final
class NodeEventProcessor:
    """Apply each node event type to its owning execution frame.

    This keeps node-event state transitions separate from worker dispatch and
    external event streaming.
    """

    def __init__(
        self,
        graph_execution: GraphExecution,
        event_stream: EventStream,
        frame_registry: FrameRegistry,
        container_handlers: Mapping[NodeType, ContainerHandler],
    ) -> None:
        """Initialize the node event processor.

        Args:
            graph_execution: Graph execution aggregate
            event_stream: Stream that collects processed engine events
            frame_registry: Registry of frame-local execution collaborators
            container_handlers: Engine-owned container handlers by node type

        """
        self._graph_execution = graph_execution
        self._event_stream = event_stream
        self._frame_registry = frame_registry
        self._container_handlers = container_handlers

    def dispatch(self, task_event: NodeEventTask) -> None:
        """Handle any task-scoped node event.

        Args:
            task_event: The frame-scoped event to handle

        """
        self._dispatch_event(frame_id=task_event.frame_id, event=task_event.event)
        frame = self._frame_registry[task_event.frame_id]
        handler = self._container_handler_for_frame(frame.frame_id)
        if handler is not None:
            handler.complete_frame_if_ready(frame)

    def start_container(self, task: ContainerAwaitTask) -> None:
        """Schedule child-frame work for a suspended container invocation."""
        root_runtime_state = self._frame_registry[ROOT_FRAME_ID].state
        run_state = root_runtime_state.get_container_run(task.invocation_id)
        parent_frame = self._frame_registry[run_state.frame_id]
        node = parent_frame.graph.nodes[run_state.node_id]
        try:
            self._container_handlers[node.node_type].handle_request(
                invocation_id=task.invocation_id,
                request=task.request,
            )
        except Exception as error:
            logger.exception(
                "Container handler failed to start node %s",
                node.id,
            )
            root_runtime_state.enqueue_ready_task(
                ResumeTask(
                    invocation_id=task.invocation_id,
                    result=ContainerExecutionResult(
                        metadata={},
                        steps=0,
                        node_run_result=ContainerNodeRunResult(
                            status=WorkflowNodeExecutionStatus.FAILED,
                            error=str(error),
                            error_type=type(error).__name__,
                        ),
                    ),
                ),
            )

    def snapshot_frames(self) -> None:
        """Persist live child frames after active workers finish for a pause."""
        root_runtime_state = self._frame_registry[ROOT_FRAME_ID].state
        for frame_state in root_runtime_state.container_frames():
            frame = self._frame_registry[frame_state.frame_id]
            variable_pool_scope = (
                "parent"
                if isinstance(frame_state.runtime_data.variable_pool, str)
                else "local"
            )
            root_runtime_state.put_container_frame(
                frame_state.model_copy(
                    update={
                        "runtime_data": frame.state.snapshot_frame(
                            variable_pool_scope=variable_pool_scope,
                        ),
                    },
                ),
            )

    def _dispatch_event(self, *, frame_id: str, event: NodeEvent) -> None:
        frame = self._frame_registry[frame_id]
        event.container_id = frame.container_id
        if isinstance(event, NodeRunVariableUpdatedEvent):
            frame.state.variable_pool.add(event.variable.selector, event.variable)
        for container_frame, handler in self._container_ancestors(frame_id):
            handler.prepare_frame_event(frame=container_frame, event=event)
        self._dispatch(event, frame=frame)

    @singledispatchmethod
    def _dispatch(self, event: NodeEvent, *, frame: ExecutionFrame) -> None:
        self._collect(frame=frame, event=event)
        logger.warning("Unhandled event type: %s", type(event).__name__)

    def _collect(self, *, frame: ExecutionFrame, event: NodeEvent) -> None:
        handler = self._container_handler_for_frame(frame.frame_id)
        if handler is not None and not handler.should_emit(event=event):
            return
        self._event_stream.collect(event)

    @_dispatch.register
    def _(
        self,
        event: (
            NodeRunIterationStartedEvent
            | NodeRunIterationNextEvent
            | NodeRunIterationSucceededEvent
            | NodeRunIterationFailedEvent
            | NodeRunLoopStartedEvent
            | NodeRunLoopNextEvent
            | NodeRunLoopSucceededEvent
            | NodeRunLoopFailedEvent
            | NodeRunAgentLogEvent
            | NodeRunModelPollingProgressEvent
            | NodeRunRetrieverResourceEvent
            | NodeRunReasoningChunkEvent
            | NodeRunStreamChunkEvent
        ),
        *,
        frame: ExecutionFrame,
    ) -> None:
        if isinstance(event, NodeRunLoopSucceededEvent):
            outputs = self._current_loop_outputs(
                frame=frame,
                node_id=event.node_id,
                outputs=event.outputs,
            )
            event.outputs = {
                key: value.to_object() if isinstance(value, Segment) else value
                for key, value in outputs.items()
            }
        self._collect(frame=frame, event=event)

    @_dispatch.register
    def _(self, event: NodeRunStartedEvent, *, frame: ExecutionFrame) -> None:
        """Handle node started event.

        Args:
            event: The node started event

        """
        # Track execution in domain model
        node_execution = self._graph_execution.get_or_create_node_execution(
            frame_id=frame.frame_id,
            node_id=event.node_id,
        )
        is_initial_attempt = node_execution.retry_count == 0
        frame.state.increment_node_run_steps()

        # Collect the event only for the first attempt; retries remain silent
        if is_initial_attempt:
            self._collect(frame=frame, event=event)

    @_dispatch.register
    def _(self, event: NodeRunVariableUpdatedEvent, *, frame: ExecutionFrame) -> None:
        """Publish a node-requested variable mutation after frame propagation.

        ``_dispatch_event`` applies the mutation before container handlers inspect
        it. This handler only collects the resulting event for outer observers.
        """
        self._collect(frame=frame, event=event)

    @_dispatch.register
    def _(self, event: NodeRunSucceededEvent, *, frame: ExecutionFrame) -> None:
        if event.node_type == BuiltinNodeTypes.LOOP:
            event.node_run_result.outputs = self._current_loop_outputs(
                frame=frame,
                node_id=event.node_id,
                outputs=event.node_run_result.outputs,
            )
        node = frame.graph.nodes[event.node_id]
        self._complete_node(
            frame=frame,
            event=event,
            follow_branch=node.execution_type == NodeExecutionType.BRANCH,
        )

    @_dispatch.register
    def _(self, event: NodeRunPauseRequestedEvent, *, frame: ExecutionFrame) -> None:
        """Handle pause requests emitted by nodes."""
        self._graph_execution.pause(event.reason)
        frame.scheduler.finish_execution(event.node_id)
        frame.graph.nodes[event.node_id].state = NodeState.UNKNOWN
        frame.state.defer_ready_task(
            StartTask(frame_id=frame.frame_id, node_id=event.node_id)
        )
        frame.scheduler.track_unfinished(event.node_id)
        self._collect(frame=frame, event=event)

    @_dispatch.register
    def _(self, event: NodeRunFailedEvent, *, frame: ExecutionFrame) -> None:
        """Resolve a node failure through its frame-local failure policy.

        Args:
            event: The node failed event

        """
        # Update domain model
        self._graph_execution.record_node_failure()

        frame.state.add_llm_usage(event.node_run_result.llm_usage)

        result = frame.failure_handler.handle(
            frame_id=frame.frame_id,
            event=event,
        )

        if result is not None:
            # Process the resulting event (retry, exception, etc.)
            self._dispatch_event(frame_id=frame.frame_id, event=result)
        else:
            handler = self._container_handler_for_frame(frame.frame_id)
            if handler is not None:
                handler.record_frame_failure(frame=frame, event=event)
            else:
                self._graph_execution.fail(RuntimeError(event.error))
            self._collect(frame=frame, event=event)
            frame.scheduler.finish_execution(event.node_id)

    @_dispatch.register
    def _(self, event: NodeRunExceptionEvent, *, frame: ExecutionFrame) -> None:
        node = frame.graph.nodes[event.node_id]
        if node.error_strategy == ErrorStrategy.DEFAULT_VALUE:
            follow_branch = False
        elif node.error_strategy == ErrorStrategy.FAIL_BRANCH:
            follow_branch = True
        else:
            msg = f"Unsupported error strategy: {node.error_strategy}"
            raise NotImplementedError(msg)

        self._complete_node(
            frame=frame,
            event=event,
            follow_branch=follow_branch,
        )

    @_dispatch.register
    def _(self, event: NodeRunRetryEvent, *, frame: ExecutionFrame) -> None:
        """Handle node retry event.

        Args:
            event: The node retry event

        """
        node_execution = self._graph_execution.get_or_create_node_execution(
            frame_id=frame.frame_id,
            node_id=event.node_id,
        )
        node_execution.increment_retry()

        # Finish the previous attempt before re-queuing the node
        frame.scheduler.finish_execution(event.node_id)

        # Emit retry event for observers
        self._collect(frame=frame, event=event)

        # Re-queue node for execution
        frame.scheduler.enqueue_node(event.node_id)

    def _complete_node(
        self,
        *,
        frame: ExecutionFrame,
        event: NodeRunSucceededEvent | NodeRunExceptionEvent,
        follow_branch: bool,
    ) -> None:
        frame.state.add_llm_usage(event.node_run_result.llm_usage)
        self._store_node_outputs(
            frame=frame,
            node_id=event.node_id,
            outputs=event.node_run_result.outputs,
        )

        if follow_branch:
            ready_nodes, edge_events = frame.scheduler.handle_branch_completion(
                event.node_id,
                event.node_run_result.edge_source_handle,
            )
        else:
            ready_nodes, edge_events = frame.scheduler.process_node_success(
                event.node_id
            )
        for edge_event in edge_events:
            edge_event.container_id = frame.container_id
            self._event_stream.collect(edge_event)
        for node_id in ready_nodes:
            frame.scheduler.enqueue_node(node_id)

        node = frame.graph.nodes[event.node_id]
        if node.execution_type == NodeExecutionType.RESPONSE:
            frame.state.merge_response_outputs(
                event.node_run_result.outputs,
            )
        frame.scheduler.finish_execution(event.node_id)
        self._collect(frame=frame, event=event)

    @staticmethod
    def _current_loop_outputs(
        *,
        frame: ExecutionFrame,
        node_id: str,
        outputs: Mapping[str, object],
    ) -> dict[str, object]:
        """Merge a completed Loop result with its authoritative parent values.

        Loop child frames operate on copies, while child variable-update events and
        external commands are serialized into the parent frame's variable pool.
        A queued Loop result may therefore carry an older child snapshot. For keys
        already present in that result, this method reads the parent value at event
        dispatch time so the most recently processed update wins. Unknown keys are
        not added, preserving the existing zero-round output contract.

        Args:
            frame: Parent execution frame that owns the Loop node.
            node_id: ID used as the first component of each Loop output selector.
            outputs: Snapshot carried by the completed Loop result.

        Returns:
            A mutable output mapping with current parent values where available.

        """
        current_outputs = dict(outputs)
        for key in outputs:
            value = frame.state.variable_pool.get((node_id, key))
            if value is not None:
                current_outputs[key] = value
        return current_outputs

    def _store_node_outputs(
        self,
        *,
        frame: ExecutionFrame,
        node_id: str,
        outputs: Mapping[str, object],
    ) -> None:
        """Store node outputs in the variable pool.

        Args:
            node_id: Identifier of the node whose outputs are being stored.
            outputs: Mapping of output names to values produced by the node.

        """
        for variable_name, variable_value in outputs.items():
            frame.state.variable_pool.add(
                (node_id, variable_name),
                variable_value,
            )

    def _container_handler_for_frame(self, frame_id: str) -> ContainerHandler | None:
        return next(
            (handler for _, handler in self._container_ancestors(frame_id)),
            None,
        )

    def _container_ancestors(
        self,
        frame_id: str,
    ) -> Iterator[tuple[ExecutionFrame, ContainerHandler]]:
        root_runtime_state = self._frame_registry[ROOT_FRAME_ID].state
        while frame_id != ROOT_FRAME_ID:
            frame_state = root_runtime_state.get_container_frame(frame_id)
            run_state = root_runtime_state.get_container_run(
                frame_state.parent_invocation_id,
            )
            parent_frame = self._frame_registry[run_state.frame_id]
            parent_node = parent_frame.graph.nodes[run_state.node_id]
            yield (
                self._frame_registry[frame_id],
                self._container_handlers[parent_node.node_type],
            )
            frame_id = run_state.frame_id
