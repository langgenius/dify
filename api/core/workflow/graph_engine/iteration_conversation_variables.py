"""Keep parent workflow variable pools in sync with iteration subgraph updates."""

from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, final

from core.workflow.variable_prefixes import CONVERSATION_VARIABLE_NODE_ID
from graphon.enums import BuiltinNodeTypes
from graphon.graph_engine.frames import FrameRegistry
from graphon.graph_engine.iteration_container_handler import IterationContainerHandler
from graphon.graph_engine.ready_queue import ROOT_FRAME_ID
from graphon.graph_events.base import GraphNodeEventBase
from graphon.graph_events.node import NodeRunFailedEvent
from graphon.nodes.container_effects import ContainerAwaitRequest
from graphon.runtime.container_state import ContainerFrameState, IterationFrameState, IterationRunState
from graphon.variables.variables import Variable

if TYPE_CHECKING:
    from graphon.graph_engine.frames import ExecutionFrame
    from graphon.runtime import VariablePool


def sync_conversation_variables_from_child_to_parent(
    *,
    child_pool: VariablePool,
    parent_pool: VariablePool,
) -> None:
    """Copy conversation-scoped variables from an iteration frame pool to its parent."""
    snapshot = _extract_conversation_variable_snapshot(child_pool)
    _apply_conversation_variable_snapshot(parent_pool, snapshot)


def _extract_conversation_variable_snapshot(
    variable_pool: VariablePool,
) -> dict[str, Variable]:
    conversation_variables = variable_pool.variable_dictionary.get(CONVERSATION_VARIABLE_NODE_ID, {})
    return {name: variable.model_copy(deep=True) for name, variable in conversation_variables.items()}


def _apply_conversation_variable_snapshot(
    variable_pool: VariablePool,
    snapshot: Mapping[str, Variable],
) -> None:
    parent_conversations = variable_pool.variable_dictionary.get(CONVERSATION_VARIABLE_NODE_ID, {})
    current_keys = set(parent_conversations.keys())
    snapshot_keys = set(snapshot.keys())

    for removed_key in current_keys - snapshot_keys:
        variable_pool.remove((CONVERSATION_VARIABLE_NODE_ID, removed_key))

    for name, variable in snapshot.items():
        variable_pool.add((CONVERSATION_VARIABLE_NODE_ID, name), variable)


@final
class DifyIterationContainerHandler:
    """Iteration handler that propagates conversation variable writes to the parent graph."""

    node_type = BuiltinNodeTypes.ITERATION

    def __init__(self, frame_registry: FrameRegistry) -> None:
        self._frame_registry = frame_registry
        self._delegate = IterationContainerHandler(frame_registry)

    def restore_frame(self, frame_state: ContainerFrameState) -> None:
        self._delegate.restore_frame(frame_state)

    def start_await(
        self,
        *,
        invocation_id: str,
        request: ContainerAwaitRequest,
    ) -> None:
        self._delegate.start_await(invocation_id=invocation_id, request=request)

    def prepare_frame_event(
        self,
        *,
        frame: ExecutionFrame,
        event: GraphNodeEventBase,
    ) -> None:
        self._delegate.prepare_frame_event(frame=frame, event=event)

    def should_collect(
        self,
        *,
        event: GraphNodeEventBase,
    ) -> bool:
        return self._delegate.should_collect(event=event)

    def record_frame_failure(
        self,
        *,
        frame: ExecutionFrame,
        event: NodeRunFailedEvent,
    ) -> None:
        self._delegate.record_frame_failure(frame=frame, event=event)

    def complete_frame(self, frame: ExecutionFrame) -> None:
        if frame.state_manager.is_execution_complete():
            self._sync_conversation_variables_for_frame(frame)
        self._delegate.complete_frame(frame)

    def _sync_conversation_variables_for_frame(self, frame: ExecutionFrame) -> None:
        root_runtime_state = self._frame_registry.get(ROOT_FRAME_ID).graph_runtime_state
        frame_state = root_runtime_state.get_container_frame(frame.frame_id)
        if not isinstance(frame_state, IterationFrameState):
            return
        run_state = root_runtime_state.get_container_run(frame_state.parent_invocation_id)
        if not isinstance(run_state, IterationRunState):
            return
        parent_frame = self._frame_registry.get(run_state.frame_id)
        sync_conversation_variables_from_child_to_parent(
            child_pool=frame.graph_runtime_state.variable_pool,
            parent_pool=parent_frame.graph_runtime_state.variable_pool,
        )


def dify_iteration_container_handler_factory(frame_registry: FrameRegistry) -> DifyIterationContainerHandler:
    return DifyIterationContainerHandler(frame_registry)


DIFY_GRAPH_ENGINE_CONTAINER_HANDLER_FACTORIES = (dify_iteration_container_handler_factory,)
