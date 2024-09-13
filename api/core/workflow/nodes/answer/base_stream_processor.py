from abc import ABC, abstractmethod
from collections.abc import Generator

from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine.entities.event import GraphEngineEvent, NodeRunSucceededEvent
from core.workflow.graph_engine.entities.graph import Graph


class StreamProcessor(ABC):
    def __init__(self, graph: Graph, variable_pool: VariablePool) -> None:
        self.graph = graph
        self.variable_pool = variable_pool
        self.rest_node_ids = graph.node_ids.copy()

    @abstractmethod
    def process(self, generator: Generator[GraphEngineEvent, None, None]) -> Generator[GraphEngineEvent, None, None]:
        raise NotImplementedError

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
                if (
                    edge.run_condition
                    and edge.run_condition.branch_identify
                    and run_result.edge_source_handle == edge.run_condition.branch_identify
                ):
                    reachable_node_ids.extend(self._fetch_node_ids_in_reachable_branch(edge.target_node_id))
                    continue
                else:
                    unreachable_first_node_ids.append(edge.target_node_id)

            for node_id in unreachable_first_node_ids:
                self._remove_node_ids_in_unreachable_branch(node_id, reachable_node_ids)

    def _fetch_node_ids_in_reachable_branch(self, node_id: str) -> list[str]:
        node_ids = []
        for edge in self.graph.edge_mapping.get(node_id, []):
            if edge.target_node_id == self.graph.root_node_id:
                continue

            node_ids.append(edge.target_node_id)
            node_ids.extend(self._fetch_node_ids_in_reachable_branch(edge.target_node_id))
        return node_ids

    def _remove_node_ids_in_unreachable_branch(self, node_id: str, reachable_node_ids: list[str]) -> None:
        """
        remove target node ids until merge
        """
        if node_id not in self.rest_node_ids:
            return

        self.rest_node_ids.remove(node_id)
        for edge in self.graph.edge_mapping.get(node_id, []):
            if edge.target_node_id in reachable_node_ids:
                continue

            self._remove_node_ids_in_unreachable_branch(edge.target_node_id, reachable_node_ids)
