"""Preserve Dify conversation variables across iteration frame boundaries."""

from typing import final

from core.workflow.variable_prefixes import CONVERSATION_VARIABLE_NODE_ID
from graphon.engine.container_handler.builtin.iteration import IterationContainerHandler
from graphon.engine.frame import ExecutionFrame, FrameRegistry
from graphon.engine_events.base import NodeEvent
from graphon.engine_events.node import NodeRunFailedEvent, NodeRunVariableUpdatedEvent
from graphon.enums import BuiltinNodeTypes
from graphon.nodes.container_effects import ContainerAwaitRequest
from graphon.runtime import VariablePool
from graphon.runtime.container_state import ContainerFrameState, IterationFrameState, IterationRunState
from graphon.runtime.execution import ROOT_FRAME_ID
from graphon.variables.variables import Variable


def _write_back_conversation_variable(
    *,
    frame_pool: VariablePool,
    parent_pool: VariablePool,
    variable: Variable,
) -> None:
    selector = variable.selector
    if selector[0] != CONVERSATION_VARIABLE_NODE_ID:
        return
    # An outer frame must not forward a stale copy when an inner container kept
    # the update private. Only variables declared in the parent may escape.
    if frame_pool.get_variable(selector) is not variable or parent_pool.get_variable(selector) is None:
        return
    parent_pool.add(selector, variable)


@final
class DifyIterationContainerHandler:
    """Forward conversation updates without publishing iteration-local state.

    Parallel rounds retain Graphon's existing last-write-wins behavior.
    """

    node_type = BuiltinNodeTypes.ITERATION

    def __init__(self, frame_registry: FrameRegistry) -> None:
        self._frame_registry = frame_registry
        self._delegate = IterationContainerHandler(frame_registry)

    def restore_frame(self, frame_state: ContainerFrameState) -> None:
        self._delegate.restore_frame(frame_state)

    def handle_request(self, *, invocation_id: str, request: ContainerAwaitRequest) -> None:
        self._delegate.handle_request(invocation_id=invocation_id, request=request)

    def prepare_frame_event(self, *, frame: ExecutionFrame, event: NodeEvent) -> None:
        self._delegate.prepare_frame_event(frame=frame, event=event)
        if not isinstance(event, NodeRunVariableUpdatedEvent):
            return

        root_state = self._frame_registry[ROOT_FRAME_ID].state
        frame_state = root_state.get_container_frame(frame.frame_id)
        if not isinstance(frame_state, IterationFrameState):
            raise TypeError(f"Iteration handler received {frame_state.kind} frame")
        run_state = root_state.get_container_run(frame_state.parent_invocation_id)
        if not isinstance(run_state, IterationRunState):
            raise TypeError(f"Iteration frame belongs to {run_state.kind} run")
        parent_frame = self._frame_registry[run_state.frame_id]
        _write_back_conversation_variable(
            frame_pool=frame.state.variable_pool,
            parent_pool=parent_frame.state.variable_pool,
            variable=event.variable,
        )

    def should_emit(self, *, event: NodeEvent) -> bool:
        return self._delegate.should_emit(event=event)

    def record_frame_failure(self, *, frame: ExecutionFrame, event: NodeRunFailedEvent) -> None:
        self._delegate.record_frame_failure(frame=frame, event=event)

    def complete_frame_if_ready(self, frame: ExecutionFrame) -> None:
        self._delegate.complete_frame_if_ready(frame)
