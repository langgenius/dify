import logging
from collections.abc import Generator
from typing import cast

from core.file import FILE_MODEL_IDENTITY, File
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine.entities.event import (
    GraphEngineEvent,
    NodeRunExceptionEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.nodes.answer.base_stream_processor import StreamProcessor
from core.workflow.nodes.answer.entities import GenerateRouteChunk, TextGenerateRouteChunk, VarGenerateRouteChunk

logger = logging.getLogger(__name__)


class AnswerStreamProcessor(StreamProcessor):
    def __init__(self, graph: Graph, variable_pool: VariablePool) -> None:
        super().__init__(graph, variable_pool)
        self.generate_routes = graph.answer_stream_generate_routes
        self.route_position = {}
        for answer_node_id in self.generate_routes.answer_generate_route:
            self.route_position[answer_node_id] = 0
        self.current_stream_chunk_generating_node_ids: dict[str, list[str]] = {}

    def process(self, generator: Generator[GraphEngineEvent, None, None]) -> Generator[GraphEngineEvent, None, None]:
        for event in generator:
            if isinstance(event, NodeRunStartedEvent):
                if event.route_node_state.node_id == self.graph.root_node_id and not self.rest_node_ids:
                    self.reset()

                yield event
            elif isinstance(event, NodeRunStreamChunkEvent):
                if event.in_iteration_id or event.in_loop_id:
                    yield event
                    continue

                if event.route_node_state.node_id in self.current_stream_chunk_generating_node_ids:
                    stream_out_answer_node_ids = self.current_stream_chunk_generating_node_ids[
                        event.route_node_state.node_id
                    ]
                else:
                    stream_out_answer_node_ids = self._get_stream_out_answer_node_ids(event)
                    self.current_stream_chunk_generating_node_ids[event.route_node_state.node_id] = (
                        stream_out_answer_node_ids
                    )

                for _ in stream_out_answer_node_ids:
                    yield event
            elif isinstance(event, NodeRunSucceededEvent | NodeRunExceptionEvent):
                yield event
                if event.route_node_state.node_id in self.current_stream_chunk_generating_node_ids:
                    # update self.route_position after all stream event finished
                    for answer_node_id in self.current_stream_chunk_generating_node_ids[event.route_node_state.node_id]:
                        self.route_position[answer_node_id] += 1

                    del self.current_stream_chunk_generating_node_ids[event.route_node_state.node_id]

                self._remove_unreachable_nodes(event)

                # generate stream outputs
                yield from self._generate_stream_outputs_when_node_finished(cast(NodeRunSucceededEvent, event))
            else:
                yield event

    def reset(self) -> None:
        self.route_position = {}
        for answer_node_id, route_chunks in self.generate_routes.answer_generate_route.items():
            self.route_position[answer_node_id] = 0
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
        for answer_node_id in self.route_position:
            # all depends on answer node id not in rest node ids
            if event.route_node_state.node_id != answer_node_id and (
                answer_node_id not in self.rest_node_ids
                or not all(
                    dep_id not in self.rest_node_ids
                    for dep_id in self.generate_routes.answer_dependencies[answer_node_id]
                )
            ):
                continue

            route_position = self.route_position[answer_node_id]
            route_chunks = self.generate_routes.answer_generate_route[answer_node_id][route_position:]

            for route_chunk in route_chunks:
                if route_chunk.type == GenerateRouteChunk.ChunkType.TEXT:
                    route_chunk = cast(TextGenerateRouteChunk, route_chunk)
                    yield NodeRunStreamChunkEvent(
                        id=event.id,
                        node_id=event.node_id,
                        node_type=event.node_type,
                        node_data=event.node_data,
                        chunk_content=route_chunk.text,
                        route_node_state=event.route_node_state,
                        parallel_id=event.parallel_id,
                        parallel_start_node_id=event.parallel_start_node_id,
                        from_variable_selector=[answer_node_id, "answer"],
                    )
                else:
                    route_chunk = cast(VarGenerateRouteChunk, route_chunk)
                    value_selector = route_chunk.value_selector
                    if not value_selector:
                        break

                    value = self.variable_pool.get(value_selector)

                    if value is None:
                        break

                    text = value.markdown

                    if text:
                        yield NodeRunStreamChunkEvent(
                            id=event.id,
                            node_id=event.node_id,
                            node_type=event.node_type,
                            node_data=event.node_data,
                            chunk_content=text,
                            from_variable_selector=list(value_selector),
                            route_node_state=event.route_node_state,
                            parallel_id=event.parallel_id,
                            parallel_start_node_id=event.parallel_start_node_id,
                        )

                self.route_position[answer_node_id] += 1

    def _get_stream_out_answer_node_ids(self, event: NodeRunStreamChunkEvent) -> list[str]:
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

        stream_out_answer_node_ids = []
        for answer_node_id, route_position in self.route_position.items():
            if answer_node_id not in self.rest_node_ids:
                continue
            # exclude current node id
            answer_dependencies = self.generate_routes.answer_dependencies
            if event.node_id in answer_dependencies[answer_node_id]:
                answer_dependencies[answer_node_id].remove(event.node_id)
            answer_dependencies_ids = answer_dependencies.get(answer_node_id, [])
            # all depends on answer node id not in rest node ids
            if all(dep_id not in self.rest_node_ids for dep_id in answer_dependencies_ids):
                if route_position >= len(self.generate_routes.answer_generate_route[answer_node_id]):
                    continue

                route_chunk = self.generate_routes.answer_generate_route[answer_node_id][route_position]

                if route_chunk.type != GenerateRouteChunk.ChunkType.VAR:
                    continue

                route_chunk = cast(VarGenerateRouteChunk, route_chunk)
                value_selector = route_chunk.value_selector

                # check chunk node id is before current node id or equal to current node id
                if value_selector != stream_output_value_selector:
                    continue

                stream_out_answer_node_ids.append(answer_node_id)

        return stream_out_answer_node_ids

    @classmethod
    def _fetch_files_from_variable_value(cls, value: dict | list) -> list[dict]:
        """
        Fetch files from variable value
        :param value: variable value
        :return:
        """
        if not value:
            return []

        files = []
        if isinstance(value, list):
            for item in value:
                file_var = cls._get_file_var_from_value(item)
                if file_var:
                    files.append(file_var)
        elif isinstance(value, dict):
            file_var = cls._get_file_var_from_value(value)
            if file_var:
                files.append(file_var)

        return files

    @classmethod
    def _get_file_var_from_value(cls, value: dict | list):
        """
        Get file var from value
        :param value: variable value
        :return:
        """
        if not value:
            return None

        if isinstance(value, dict):
            if "dify_model_identity" in value and value["dify_model_identity"] == FILE_MODEL_IDENTITY:
                return value
        elif isinstance(value, File):
            return value.to_dict()

        return None
