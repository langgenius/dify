from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, override

from graphon.graph_events import GraphNodeEventBase, GraphRunPartialSucceededEvent, GraphRunSucceededEvent
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.nodes.iteration.iteration_node import IterationNode
from graphon.runtime import VariablePool


class DifyIterationNode(IterationNode):
    """Dify compatibility layer for Graphon's iteration node."""

    @classmethod
    def version(cls) -> str:
        return IterationNode.version()

    @override
    def _execute_parallel_iteration_with_graph_engine(
        self,
        *,
        graph_engine: Any,
    ) -> tuple[float, list[GraphNodeEventBase], object | None, LLMUsage]:
        iter_start_at = datetime.now(UTC).replace(tzinfo=None)
        outputs_temp: list[object] = []
        events: list[GraphNodeEventBase] = []
        variable_pool = graph_engine.graph_runtime_state.variable_pool
        current_index = self._get_current_iteration_index(variable_pool)

        for event in graph_engine.run():
            if isinstance(event, GraphRunSucceededEvent | GraphRunPartialSucceededEvent):
                outputs_temp.append(self._get_parallel_iteration_output(variable_pool=variable_pool, events=events))
                break

            event_to_yield, stop_iteration = self._process_single_iteration_event(
                event=event,
                current_index=current_index,
                variable_pool=variable_pool,
                outputs=outputs_temp,
            )
            if event_to_yield is not None:
                events.append(event_to_yield)
            if stop_iteration:
                break

        output_value = outputs_temp[0] if outputs_temp else None
        iteration_duration = (datetime.now(UTC).replace(tzinfo=None) - iter_start_at).total_seconds()

        return (
            iteration_duration,
            events,
            output_value,
            graph_engine.graph_runtime_state.llm_usage,
        )

    def _get_parallel_iteration_output(
        self,
        *,
        variable_pool: VariablePool,
        events: list[GraphNodeEventBase],
    ) -> object | None:
        result = variable_pool.get(self.node_data.output_selector)
        if result is not None:
            return result.to_object()

        return self._get_output_from_child_events(events=events)

    def _get_output_from_child_events(self, *, events: list[GraphNodeEventBase]) -> object | None:
        output_selector = self.node_data.output_selector
        if len(output_selector) < 2:
            return None

        selected_node_id = output_selector[0]
        selected_output_name = output_selector[1]
        nested_selector = output_selector[2:]

        for event in reversed(events):
            if event.node_id != selected_node_id:
                continue

            value = event.node_run_result.outputs.get(selected_output_name)
            if nested_selector:
                return self._get_nested_output(value=value, selector=nested_selector)
            return value

        return None

    @staticmethod
    def _get_nested_output(*, value: object, selector: list[str]) -> object | None:
        current = value
        for key in selector:
            if not isinstance(current, Mapping):
                return None
            current = current.get(key)
        return current
