import logging
from collections.abc import Generator

from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine.entities.event import (
    GraphEngineEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from core.workflow.graph_engine.entities.graph import Graph

logger = logging.getLogger(__name__)


class EndStreamProcessor:

    def __init__(self, graph: Graph, variable_pool: VariablePool) -> None:
        self.graph = graph
        self.variable_pool = variable_pool
        self.stream_param = graph.end_stream_param
        self.end_streamed_variable_selectors = graph.end_stream_param.end_stream_variable_selector_mapping.copy()
        self.rest_node_ids = graph.node_ids.copy()
        self.current_stream_chunk_generating_node_ids: dict[str, list[str]] = {}

    def process(self,
                generator: Generator[GraphEngineEvent, None, None]
                ) -> Generator[GraphEngineEvent, None, None]:
        for event in generator:
            if isinstance(event, NodeRunStreamChunkEvent):
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
        self.end_streamed_variable_selectors = {}
        self.end_streamed_variable_selectors: dict[str, list[str]] = {
            end_node_id: [] for end_node_id in self.graph.end_stream_param.end_stream_variable_selector_mapping
        }
        self.rest_node_ids = self.graph.node_ids.copy()
        self.current_stream_chunk_generating_node_ids = {}

    def _remove_unreachable_nodes(self, event: NodeRunSucceededEvent) -> None:
        finished_node_id = event.route_node_state.node_id
        if finished_node_id not in self.rest_node_ids:
            return

        # remove finished node id
        self.rest_node_ids.remove(finished_node_id)

        run_result = event.route_node_state.node_run_result
        if not run_result:
            return

        if run_result.edge_source_handle:
            reachable_node_ids = []
            unreachable_first_node_ids = []
            for edge in self.graph.edge_mapping[finished_node_id]:
                if (edge.run_condition
                        and edge.run_condition.branch_identify
                        and run_result.edge_source_handle == edge.run_condition.branch_identify):
                    reachable_node_ids.extend(self._fetch_node_ids_in_reachable_branch(edge.target_node_id))
                    continue
                else:
                    unreachable_first_node_ids.append(edge.target_node_id)

            for node_id in unreachable_first_node_ids:
                self._remove_node_ids_in_unreachable_branch(node_id, reachable_node_ids)

    def _fetch_node_ids_in_reachable_branch(self, node_id: str) -> list[str]:
        node_ids = []
        for edge in self.graph.edge_mapping.get(node_id, []):
            node_ids.append(edge.target_node_id)
            node_ids.extend(self._fetch_node_ids_in_reachable_branch(edge.target_node_id))
        return node_ids

    def _remove_node_ids_in_unreachable_branch(self, node_id: str, reachable_node_ids: list[str]) -> None:
        """
        remove target node ids until merge
        """
        self.rest_node_ids.remove(node_id)
        for edge in self.graph.edge_mapping.get(node_id, []):
            if edge.target_node_id in reachable_node_ids:
                continue

            self._remove_node_ids_in_unreachable_branch(edge.target_node_id, reachable_node_ids)

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
