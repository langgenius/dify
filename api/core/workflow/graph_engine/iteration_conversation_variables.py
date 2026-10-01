"""Keep parent workflow variable pools in sync with iteration subgraph updates."""

from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, final, override

from core.workflow.variable_prefixes import CONVERSATION_VARIABLE_NODE_ID
from graphon.graph_engine.frames import FrameRegistry
from graphon.graph_engine.iteration_container_handler import IterationContainerHandler
from graphon.runtime.container_state import IterationFrameState, IterationRunState
from graphon.variables.segments import SerializableSegment
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
class DifyIterationContainerHandler(IterationContainerHandler):
    """Iteration handler that propagates conversation variable writes to the parent graph."""

    @override
    def _complete_iteration_step(
        self,
        *,
        frame: ExecutionFrame,
        frame_state: IterationFrameState,
        parent_frame: ExecutionFrame,
        run_state: IterationRunState,
        output: SerializableSegment,
        store_output: bool,
    ) -> IterationRunState:
        sync_conversation_variables_from_child_to_parent(
            child_pool=frame.graph_runtime_state.variable_pool,
            parent_pool=parent_frame.graph_runtime_state.variable_pool,
        )
        return super()._complete_iteration_step(
            frame=frame,
            frame_state=frame_state,
            parent_frame=parent_frame,
            run_state=run_state,
            output=output,
            store_output=store_output,
        )


def dify_iteration_container_handler_factory(frame_registry: FrameRegistry) -> DifyIterationContainerHandler:
    return DifyIterationContainerHandler(frame_registry)


DIFY_GRAPH_ENGINE_CONTAINER_HANDLER_FACTORIES = (dify_iteration_container_handler_factory,)
