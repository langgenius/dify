from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import cast, final

from graphon.graph_engine.frames import ExecutionFrame, FrameRegistry
from graphon.graph_engine.iteration_container_handler import IterationContainerHandler
from graphon.graph_events.base import GraphNodeEventBase
from graphon.graph_events.node import NodeRunSucceededEvent
from graphon.runtime import GraphRuntimeState
from graphon.runtime.container_state import IterationFrameState
from graphon.variables.factory import build_segment
from graphon.variables.segments import NoneSegment, Segment, SerializableSegment


@final
class DifyIterationContainerHandler(IterationContainerHandler):
    """Iteration handler that preserves child outputs in parallel mode.

    Graphon's parallel iteration collector reads the selected output from the
    child frame variable pool when a child graph finishes. In some parallel runs
    the selected value is present on the child success event but is not yet
    readable from the child variable pool, which produces ``[null]`` outputs.
    """

    def __init__(self, frame_registry: FrameRegistry) -> None:
        super().__init__(frame_registry)
        self._frame_node_outputs: dict[str, dict[str, dict[str, object]]] = {}

    def prepare_frame_event(
        self,
        *,
        frame: ExecutionFrame,
        event: GraphNodeEventBase,
    ) -> None:
        super().prepare_frame_event(frame=frame, event=event)
        if isinstance(event, NodeRunSucceededEvent):
            self._frame_node_outputs.setdefault(frame.frame_id, {})[event.node_id] = dict(
                event.node_run_result.outputs
            )

    def complete_frame(self, frame: ExecutionFrame) -> None:
        try:
            super().complete_frame(frame)
        finally:
            self._frame_node_outputs.pop(frame.frame_id, None)

    def _start_iteration_frame(
        self,
        *,
        parent_frame: ExecutionFrame,
        run_state,
        index: int,
    ) -> None:
        variable_pool = parent_frame.graph_runtime_state.variable_pool.model_copy(
            deep=True,
        )
        variable_pool.add([run_state.node_id, "index"], index)
        variable_pool.add([run_state.node_id, "item"], run_state.items[index])
        parent_runtime_state = parent_frame.graph_runtime_state
        child_runtime_state = GraphRuntimeState(
            variable_pool=variable_pool,
            start_at=parent_runtime_state.start_at,
            ready_queue=parent_runtime_state.ready_queue,
            deferred_ready_queue=parent_runtime_state.deferred_ready_queue,
            graph_execution=parent_runtime_state.graph_execution,
            execution_context=parent_runtime_state.execution_context,
        )
        child_frame_id = f"{run_state.invocation_id}:iteration:{index}"
        child_frame = self._frame_registry.materialize_child_frame(
            frame_id=child_frame_id,
            root_node_id=run_state.root_node_id,
            graph_runtime_state=child_runtime_state,
        )
        self._root_runtime_state().put_container_frame(
            IterationFrameState(
                frame_id=child_frame_id,
                parent_invocation_id=run_state.invocation_id,
                root_node_id=run_state.root_node_id,
                index=index,
                started_at=datetime.now(UTC).replace(tzinfo=None),
                runtime_data=child_frame.graph_runtime_state.snapshot_frame(
                    copy_variable_pool=False,
                ),
            ),
        )
        child_frame.state_manager.enqueue_node(run_state.root_node_id)

    def _complete_ready_iteration_frame(
        self,
        *,
        frame: ExecutionFrame,
        frame_state: IterationFrameState,
    ) -> None:
        run_state = self._iteration_run(frame_state.parent_invocation_id)
        parent_frame = self._frame_registry.get(run_state.frame_id)
        if frame_state.errors:
            self._complete_failed_iteration_frame(
                frame=frame,
                frame_state=frame_state,
                parent_frame=parent_frame,
                run_state=run_state,
                error=frame_state.errors[0],
            )
            return

        result = self._resolve_iteration_output_segment(
            frame=frame,
            output_selector=run_state.output_selector,
        )
        output = NoneSegment() if result is None else cast(SerializableSegment, result)
        run_state = self._complete_iteration_step(
            frame=frame,
            frame_state=frame_state,
            parent_frame=parent_frame,
            run_state=run_state,
            output=output,
            store_output=True,
        )
        self._continue_or_complete_iteration(
            parent_frame=parent_frame,
            run_state=run_state,
        )

    def _resolve_iteration_output_segment(
        self,
        *,
        frame: ExecutionFrame,
        output_selector: list[str],
    ) -> Segment | None:
        result = frame.graph_runtime_state.variable_pool.get(output_selector)
        if result is not None:
            return result
        return self._segment_from_recorded_outputs(
            frame_id=frame.frame_id,
            output_selector=output_selector,
        )

    def _segment_from_recorded_outputs(
        self,
        *,
        frame_id: str,
        output_selector: list[str],
    ) -> Segment | None:
        if len(output_selector) < 2:
            return None

        node_id = output_selector[0]
        output_name = output_selector[1]
        nested_selector = output_selector[2:]
        node_outputs = self._frame_node_outputs.get(frame_id, {}).get(node_id)
        if node_outputs is None:
            return None

        value = node_outputs.get(output_name)
        if value is None:
            return None
        if nested_selector:
            value = self._get_nested_output(value=value, selector=nested_selector)
            if value is None:
                return None
        return build_segment(value)

    @staticmethod
    def _get_nested_output(*, value: object, selector: list[str]) -> object | None:
        current = value
        for key in selector:
            if not isinstance(current, Mapping):
                return None
            current = current.get(key)
        return current


def create_dify_iteration_container_handler(frame_registry: FrameRegistry) -> DifyIterationContainerHandler:
    return DifyIterationContainerHandler(frame_registry)
