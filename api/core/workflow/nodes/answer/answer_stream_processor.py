import logging
from collections.abc import Generator
from typing import cast

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
    def __init__(self, graph: Graph, variable_pool: VariablePool, node_run_state=None):
        super().__init__(graph, variable_pool, node_run_state)
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
                if event.route_node_state.node_id in self.current_stream_chunk_generating_node_ids:  # ty: ignore [unresolved-attribute]
                    # update self.route_position after all stream event finished
                    for answer_node_id in self.current_stream_chunk_generating_node_ids[event.route_node_state.node_id]:  # ty: ignore [unresolved-attribute]
                        self.route_position[answer_node_id] += 1

                    del self.current_stream_chunk_generating_node_ids[event.route_node_state.node_id]  # ty: ignore [unresolved-attribute]

                self._remove_unreachable_nodes(event)

                # generate stream outputs
                yield from self._generate_stream_outputs_when_node_finished(cast(NodeRunSucceededEvent, event))
            else:
                yield event

    def reset(self):
        self.route_position = {}
        for answer_node_id, _ in self.generate_routes.answer_generate_route.items():
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
            # Check if Answer node should output
            if event.route_node_state.node_id != answer_node_id and (
                answer_node_id not in self.rest_node_ids
                or not self._is_dynamic_dependencies_met(answer_node_id, event.route_node_state.node_id)
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
                        node_version=event.node_version,
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
                            node_version=event.node_version,
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
        stream_out_answer_node_ids = []
        for answer_node_id, route_position in self.route_position.items():
            if answer_node_id not in self.rest_node_ids:
                continue
            # Use hybrid dependency check for streaming
            if self._is_dynamic_dependencies_met(answer_node_id, event.route_node_state.node_id):
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

    def _is_dynamic_dependencies_met(self, answer_node_id: str, llm_node_id: str) -> bool:
        """
        Check if Answer node dependencies are met using hybrid static/dynamic analysis
        """
        if not self.node_run_state:
            # Fallback to original static logic
            answer_dependencies_ids = self.generate_routes.answer_dependencies.get(answer_node_id, [])
            return all(dep_id not in self.rest_node_ids for dep_id in answer_dependencies_ids)

        # Conservative strategy: try static check first
        answer_dependencies_ids = self.generate_routes.answer_dependencies.get(answer_node_id, [])
        static_result = all(dep_id not in self.rest_node_ids for dep_id in answer_dependencies_ids)

        if static_result:
            return True

        # Only use dynamic check for branch merge scenarios
                # Check if there's branch merge anywhere in the path from answer to start
        has_branch_merge = self._has_branch_merge_in_path(answer_node_id)
        if not has_branch_merge:
            return False

        # Dynamic check: trace back from LLM to Start node
        visited = set()

        def _trace_path_to_start(node_id: str) -> bool:
            if node_id in visited:
                return False
            visited.add(node_id)

            if node_id == self.graph.root_node_id:
                return True

            reverse_edges = self.graph.reverse_edge_mapping.get(node_id, [])
            if not reverse_edges:
                return False

            # Check node execution state
            node_execution_state = None
            for route_state in self.node_run_state.node_state_mapping.values():
                if route_state.node_id == node_id:
                    node_execution_state = route_state
                    break

            is_current_llm_node = node_id == llm_node_id

            if not node_execution_state:
                return False

            # Allow running state for current LLM node
            if is_current_llm_node:
                if node_execution_state.status.value not in ["running", "success"]:
                    return False
            else:
                if node_execution_state.status.value != "success":
                    return False

            # Check if any upstream path is valid
            for edge in reverse_edges:
                source_node_id = edge.source_node_id

                if edge.run_condition and edge.run_condition.branch_identify:
                    # Verify branch was actually executed
                    source_execution_state = None
                    for route_state in self.node_run_state.node_state_mapping.values():
                        if route_state.node_id == source_node_id:
                            source_execution_state = route_state
                            break

                    if (
                        source_execution_state
                        and source_execution_state.node_run_result
                        and source_execution_state.node_run_result.edge_source_handle
                        == edge.run_condition.branch_identify
                    ):
                        if _trace_path_to_start(source_node_id):
                            return True
                else:
                    # Unconditional edge
                    if _trace_path_to_start(source_node_id):
                        return True

            return False

        return _trace_path_to_start(llm_node_id)

    def _has_branch_merge_in_path(self, start_node_id: str) -> bool:
        """
        Check if there's conditional branch merge scenario (specifically for if/else convergence)
        More conservative approach to avoid affecting parallel/iteration scenarios
        """
        visited = set()

        def _check_conditional_merge_recursive(node_id: str) -> bool:
            if node_id in visited:
                return False
            visited.add(node_id)

            if node_id == self.graph.root_node_id:
                return False

            reverse_edges = self.graph.reverse_edge_mapping.get(node_id, [])

            # Check if this node has multiple incoming edges from conditional sources
            conditional_incoming = 0
            for edge in reverse_edges:
                # Only count edges that have run conditions (conditional branches)
                if hasattr(edge, 'run_condition') and edge.run_condition:
                    conditional_incoming += 1
                # Also check if source is an if/else type node
                elif hasattr(edge, 'source_node_id'):
                    source_config = self.graph.node_id_config_mapping.get(edge.source_node_id, {})
                    if source_config.get('data', {}).get('type') in ['if_else']:
                        conditional_incoming += 1

            # Only consider it a branch merge if multiple conditional branches converge
            if conditional_incoming > 1:
                return True

            # Recursively check upstream nodes, but more conservatively
            return any(_check_conditional_merge_recursive(edge.source_node_id) for edge in reverse_edges)

        return _check_conditional_merge_recursive(start_node_id)
