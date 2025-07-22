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
from core.workflow.graph_engine.entities.runtime_route_state import RouteNodeState, RuntimeRouteState
from core.workflow.nodes.answer.base_stream_processor import StreamProcessor
from core.workflow.nodes.answer.entities import GenerateRouteChunk, TextGenerateRouteChunk, VarGenerateRouteChunk

logger = logging.getLogger(__name__)


class AnswerStreamProcessor(StreamProcessor):
    def __init__(self, graph: Graph, variable_pool: VariablePool, node_run_state: RuntimeRouteState) -> None:
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

    def _is_dynamic_dependencies_met(self, start_node_id: str) -> bool:
        """
        Performs a dynamic, runtime dependency check by traversing backwards from a given start_node_id.

        This method is the core of the new streaming architecture. Instead of relying on a pre-calculated,
        static dependency map, it validates the actual execution path at the moment a stream event is received.
        It queries the runtime state of the graph ('the logbook') to ensure that a valid, uninterrupted,
        and logically sound path exists from the start_node_id all the way back to the graph's entry point.

        The traversal logic handles:
        - Basic node completion states (SUCCEEDED, FAILED, RUNNING).
        - Complex branch nodes (If/Else), by checking which branch was actually taken during the run.
          Paths from branches that were not taken are considered irrelevant ("parallel universes") and ignored.

        This approach correctly handles complex topologies with join points (nodes with multiple inputs),
        ensuring that streaming is only permitted when the true, logical dependency chain for the *current run*
        has been successfully completed.

        :param start_node_id: The node ID from which to begin the backward traversal (e.g., the LLM node).
        :return: True if all dependencies on the active path are met, False otherwise.
        """
        # Use a queue for BFS and a set to track visited nodes to prevent cycles
        queue = [start_node_id]
        visited = {start_node_id}

        while queue:
            current_node_id = queue.pop(0)

            # Get the edges leading to the current node
            parent_edges = self.graph.reverse_edge_mapping.get(current_node_id, [])
            if not parent_edges:
                continue

            for edge in parent_edges:
                parent_node_id = edge.source_node_id

                if parent_node_id in visited:
                    continue

                visited.add(parent_node_id)

                # Find the latest execution state of the parent node in the current run
                parent_node_run_state = None
                for state in self.node_run_state.node_state_mapping.values():
                    if state.node_id == parent_node_id:
                        parent_node_run_state = state
                        break # Assume the last found state is the latest for simplicity

                if not parent_node_run_state or parent_node_run_state.status == RouteNodeState.Status.RUNNING:
                    return False

                if parent_node_run_state.status in [RouteNodeState.Status.FAILED, RouteNodeState.Status.EXCEPTION]:
                    return False

                # If the parent is a branch node, check if the executed branch leads to the current node
                parent_node_config = self.graph.node_id_config_mapping.get(parent_node_id, {})
                parent_node_type = parent_node_config.get('data', {}).get('type')

                is_branch_node = parent_node_type in ['if-else', 'question-classifier'] # Example branch types

                if is_branch_node:
                    run_result = parent_node_run_state.node_run_result
                    chosen_handle = run_result.edge_source_handle if run_result else None
                    required_handle = edge.run_condition.branch_identify if edge.run_condition else None

                    # If the chosen branch does not match the path we are traversing, this dependency path is irrelevant
                    if chosen_handle and required_handle and chosen_handle != required_handle:
                        continue # This path was not taken, so it's not a dependency

                # If all checks pass, add the parent to the queue to continue traversing up
                queue.append(parent_node_id)

        return True

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
                or not self._is_dynamic_dependencies_met(answer_node_id) # Using dynamic check for final output as well
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
        if not stream_output_value_selector:
            return []

        stream_out_answer_node_ids = []
        for answer_node_id, route_position in self.route_position.items():
            if answer_node_id not in self.rest_node_ids:
                continue

            # New dynamic dependency check, replacing the old static dependency list.
            source_node_id_for_check = event.from_variable_selector[0]
            all_deps_finished = self._is_dynamic_dependencies_met(start_node_id=source_node_id_for_check)

            if all_deps_finished:
                if route_position >= len(self.generate_routes.answer_generate_route.get(answer_node_id, [])):
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
