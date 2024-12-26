import logging
from collections.abc import Generator

from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine.entities.event import (
    GraphEngineEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.nodes.answer.base_stream_processor import StreamProcessor

logger = logging.getLogger(__name__)


class EndStreamProcessor(StreamProcessor):
    def __init__(self, graph: Graph, variable_pool: VariablePool) -> None:
        super().__init__(graph, variable_pool)
        self.end_stream_param = graph.end_stream_param
        self.route_position = {}
        for end_node_id, _ in self.end_stream_param.end_stream_variable_selector_mapping.items():
            self.route_position[end_node_id] = 0
        self.current_stream_chunk_generating_node_ids: dict[str, list[str]] = {}
        self.has_output = False
        self.output_node_ids: set[str] = set()

    def process(self, generator: Generator[GraphEngineEvent, None, None]) -> Generator[GraphEngineEvent, None, None]:
        for event in generator:
            if isinstance(event, NodeRunStartedEvent):
                if event.route_node_state.node_id == self.graph.root_node_id and not self.rest_node_ids:
                    self.reset()

                yield event
            elif isinstance(event, NodeRunStreamChunkEvent):
                if event.in_iteration_id:
                    if self.has_output and event.node_id not in self.output_node_ids:
                        event.chunk_content = "\n" + event.chunk_content

                    self.output_node_ids.add(event.node_id)
                    self.has_output = True
                    yield event
                    continue

                if event.route_node_state.node_id in self.current_stream_chunk_generating_node_ids:
                    stream_out_end_node_ids = self.current_stream_chunk_generating_node_ids[
                        event.route_node_state.node_id
                    ]
                else:
                    stream_out_end_node_ids = self._get_stream_out_end_node_ids(event)
                    self.current_stream_chunk_generating_node_ids[event.route_node_state.node_id] = (
                        stream_out_end_node_ids
                    )

                if stream_out_end_node_ids:
                    if self.has_output and event.node_id not in self.output_node_ids:
                        event.chunk_content = "\n" + event.chunk_content

                    self.output_node_ids.add(event.node_id)
                    self.has_output = True
                    yield event
            elif isinstance(event, NodeRunSucceededEvent):
                yield event
                if event.route_node_state.node_id in self.current_stream_chunk_generating_node_ids:
                    # update self.route_position after all stream event finished
                    for end_node_id in self.current_stream_chunk_generating_node_ids[event.route_node_state.node_id]:
                        self.route_position[end_node_id] += 1

                    del self.current_stream_chunk_generating_node_ids[event.route_node_state.node_id]

                # remove unreachable nodes
                self._remove_unreachable_nodes(event)

                # generate stream outputs
                yield from self._generate_stream_outputs_when_node_finished(event)
            else:
                yield event

    def reset(self) -> None:
        self.route_position = {}
        for end_node_id, _ in self.end_stream_param.end_stream_variable_selector_mapping.items():
            self.route_position[end_node_id] = 0
        self.rest_node_ids = self.graph.node_ids.copy()
        self.current_stream_chunk_generating_node_ids = {}

    def _generate_stream_outputs_when_node_finished(
        self, event: NodeRunSucceededEvent
    ) -> Generator[GraphEngineEvent, None, None]:
        """
        Generate stream outputs.
        :param event: node run succeeded event
        :return:
        """
        for end_node_id, position in self.route_position.items():
            # all depends on end node id not in rest node ids
            if event.route_node_state.node_id != end_node_id and (
                end_node_id not in self.rest_node_ids
                or not all(
                    dep_id not in self.rest_node_ids for dep_id in self.end_stream_param.end_dependencies[end_node_id]
                )
            ):
                continue

            route_position = self.route_position[end_node_id]

            position = 0
            value_selectors = []
            for current_value_selectors in self.end_stream_param.end_stream_variable_selector_mapping[end_node_id]:
                if position >= route_position:
                    value_selectors.append(current_value_selectors)

                position += 1

            for value_selector in value_selectors:
                if not value_selector:
                    continue

                value = self.variable_pool.get(value_selector)

                if value is None:
                    break

                text = value.markdown

                if text:
                    current_node_id = value_selector[0]
                    if self.has_output and current_node_id not in self.output_node_ids:
                        text = "\n" + text

                    self.output_node_ids.add(current_node_id)
                    self.has_output = True
                    yield NodeRunStreamChunkEvent(
                        id=event.id,
                        node_id=event.node_id,
                        node_type=event.node_type,
                        node_data=event.node_data,
                        chunk_content=text,
                        from_variable_selector=value_selector,
                        route_node_state=event.route_node_state,
                        parallel_id=event.parallel_id,
                        parallel_start_node_id=event.parallel_start_node_id,
                    )

                self.route_position[end_node_id] += 1

    def _get_stream_out_end_node_ids(self, event: NodeRunStreamChunkEvent) -> list[str]:
        """
        Is stream out support
        :param event: queue text chunk event
        :return:
        """
        if not event.from_variable_selector:
            return []

        stream_output_value_selector = event.from_variable_selector
        if not stream_output_value_selector:
            return []

        stream_out_end_node_ids = []
        for end_node_id, route_position in self.route_position.items():
            if end_node_id not in self.rest_node_ids:
                continue

            # all depends on end node id not in rest node ids
            if all(dep_id not in self.rest_node_ids for dep_id in self.end_stream_param.end_dependencies[end_node_id]):
                if route_position >= len(self.end_stream_param.end_stream_variable_selector_mapping[end_node_id]):
                    continue

                position = 0
                value_selector = None
                for current_value_selectors in self.end_stream_param.end_stream_variable_selector_mapping[end_node_id]:
                    if position == route_position:
                        value_selector = current_value_selectors
                        break

                    position += 1

                if not value_selector:
                    continue

                # check chunk node id is before current node id or equal to current node id
                if value_selector != stream_output_value_selector:
                    continue

                stream_out_end_node_ids.append(end_node_id)

        return stream_out_end_node_ids
