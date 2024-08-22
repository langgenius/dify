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
        self.stream_param = graph.end_stream_param
        self.end_streamed_variable_selectors = graph.end_stream_param.end_stream_variable_selector_mapping.copy()
        self.current_stream_chunk_generating_node_ids: dict[str, list[str]] = {}

    def process(self,
                generator: Generator[GraphEngineEvent, None, None]
                ) -> Generator[GraphEngineEvent, None, None]:
        for event in generator:
            if isinstance(event, NodeRunStartedEvent):
                if event.route_node_state.node_id == self.graph.root_node_id and not self.rest_node_ids:
                    self.reset()

                yield event
            elif isinstance(event, NodeRunStreamChunkEvent):
                if event.route_node_state.node_id in self.current_stream_chunk_generating_node_ids:
                    stream_out_end_node_ids = self.current_stream_chunk_generating_node_ids[
                        event.route_node_state.node_id
                    ]
                else:
                    stream_out_end_node_ids = self._get_stream_out_end_node_ids(event)
                    self.current_stream_chunk_generating_node_ids[
                        event.route_node_state.node_id
                    ] = stream_out_end_node_ids

                for _ in stream_out_end_node_ids:
                    yield event
            elif isinstance(event, NodeRunSucceededEvent):
                yield event
                if event.route_node_state.node_id in self.current_stream_chunk_generating_node_ids:
                    del self.current_stream_chunk_generating_node_ids[event.route_node_state.node_id]

                # remove unreachable nodes
                self._remove_unreachable_nodes(event)
            else:
                yield event

    def reset(self) -> None:
        self.end_streamed_variable_selectors = self.graph.end_stream_param.end_stream_variable_selector_mapping.copy()
        self.rest_node_ids = self.graph.node_ids.copy()
        self.current_stream_chunk_generating_node_ids = {}

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
        for end_node_id, variable_selectors in self.end_streamed_variable_selectors.items():
            if end_node_id not in self.rest_node_ids:
                continue

            # all depends on end node id not in rest node ids
            if all(dep_id not in self.rest_node_ids
                   for dep_id in self.stream_param.end_dependencies[end_node_id]):
                if stream_output_value_selector not in variable_selectors:
                    continue

                stream_out_end_node_ids.append(end_node_id)

        return stream_out_end_node_ids
