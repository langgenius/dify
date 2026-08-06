from __future__ import annotations

from collections.abc import Mapping
from typing import final

from graphon.graph_engine.frames import ExecutionFrame, FrameRegistry
from graphon.graph_engine.iteration_container_handler import IterationContainerHandler
from graphon.graph_engine.ready_queue import ROOT_FRAME_ID
from graphon.graph_events.base import GraphNodeEventBase
from graphon.graph_events.node import NodeRunFailedEvent, NodeRunSucceededEvent
from graphon.nodes.container_effects import ContainerAwaitRequest
from graphon.runtime.container_state import ContainerFrameState, IterationFrameState, IterationRunState
from graphon.variables.factory import build_segment
from graphon.variables.segments import Segment


@final
class DifyIterationContainerHandler:
    """Iteration handler wrapper that preserves child outputs in parallel mode.

    Graphon's parallel iteration collector reads the selected output from the
    child frame variable pool when a child graph finishes. In some parallel runs
    the selected value is present on the child success event but is not yet
    readable from the child variable pool, which produces ``[null]`` outputs.
    """

    node_type = IterationContainerHandler.node_type

    def __init__(self, frame_registry: FrameRegistry) -> None:
        self._delegate = IterationContainerHandler(frame_registry)
        self._frame_registry = frame_registry
        self._frame_node_outputs: dict[str, dict[str, dict[str, object]]] = {}

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
        if isinstance(event, NodeRunSucceededEvent):
            self._frame_node_outputs.setdefault(frame.frame_id, {})[event.node_id] = dict(
                event.node_run_result.outputs
            )

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
        try:
            self._backfill_iteration_output_if_needed(frame)
            self._delegate.complete_frame(frame)
        finally:
            self._frame_node_outputs.pop(frame.frame_id, None)

    def _backfill_iteration_output_if_needed(self, frame: ExecutionFrame) -> None:
        root_runtime_state = self._frame_registry.get(ROOT_FRAME_ID).graph_runtime_state
        frame_state = root_runtime_state.get_container_frame(frame.frame_id)
        if not isinstance(frame_state, IterationFrameState):
            return

        run_state = root_runtime_state.get_container_run(frame_state.parent_invocation_id)
        if not isinstance(run_state, IterationRunState):
            return

        output_selector = list(run_state.output_selector)
        if len(output_selector) < 2:
            return
        if frame.graph_runtime_state.variable_pool.get(output_selector) is not None:
            return

        segment = self._segment_from_recorded_outputs(
            frame_id=frame.frame_id,
            output_selector=output_selector,
        )
        if segment is None:
            return

        frame.graph_runtime_state.variable_pool.add(
            (output_selector[0], output_selector[1]),
            segment.to_object(),
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
