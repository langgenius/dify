import logging
from abc import ABC, abstractmethod
from collections.abc import Generator
from typing import Optional

from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine.entities.event import GraphEngineEvent, NodeRunExceptionEvent, NodeRunSucceededEvent
from core.workflow.graph_engine.entities.graph import Graph

logger = logging.getLogger(__name__)


class StreamProcessor(ABC):
    def __init__(self, graph: Graph, variable_pool: VariablePool) -> None:
        self.graph = graph
        self.variable_pool = variable_pool
        self.rest_node_ids = graph.node_ids.copy()

    @abstractmethod
    def process(self, generator: Generator[GraphEngineEvent, None, None]) -> Generator[GraphEngineEvent, None, None]:
        raise NotImplementedError

    def _remove_unreachable_nodes(self, event: NodeRunSucceededEvent | NodeRunExceptionEvent) -> None:
        finished_node_id = event.route_node_state.node_id
        if finished_node_id not in self.rest_node_ids:
            return

        # remove finished node id
        self.rest_node_ids.remove(finished_node_id)

        run_result = event.route_node_state.node_run_result
        if not run_result:
            return

        if run_result.edge_source_handle:
            reachable_node_ids: list[str] = []
            unreachable_first_node_ids: list[str] = []
            if finished_node_id not in self.graph.edge_mapping:
                logger.warning(f"node {finished_node_id} has no edge mapping")
                return
            for edge in self.graph.edge_mapping[finished_node_id]:
                if (
                    edge.run_condition
                    and edge.run_condition.branch_identify
                    and run_result.edge_source_handle == edge.run_condition.branch_identify
                ):
                    # remove unreachable nodes
                    # FIXME: because of the code branch can combine directly, so for answer node
                    # we remove the node maybe shortcut the answer node, so comment this code for now
                    # there is not effect on the answer node and the workflow, when we have a better solution
                    # we can open this code. Issues: #11542 #9560 #10638 #10564
                    # ids = self._fetch_node_ids_in_reachable_branch(edge.target_node_id)
                    # if "answer" in ids:
                    #     continue
                    # else:
                    #     reachable_node_ids.extend(ids)

                    # The branch_identify parameter is added to ensure that
                    # only nodes in the correct logical branch are included.
                    ids = self._fetch_node_ids_in_reachable_branch(edge.target_node_id, run_result.edge_source_handle)
                    reachable_node_ids.extend(ids)
                else:
                    unreachable_first_node_ids.append(edge.target_node_id)

            for node_id in unreachable_first_node_ids:
                self._remove_node_ids_in_unreachable_branch(node_id, reachable_node_ids)

    def _fetch_node_ids_in_reachable_branch(self, node_id: str, branch_identify: Optional[str] = None) -> list[str]:
        node_ids = []
        for edge in self.graph.edge_mapping.get(node_id, []):
            if edge.target_node_id == self.graph.root_node_id:
                continue

            # Only follow edges that match the branch_identify or have no run_condition
            if edge.run_condition and edge.run_condition.branch_identify:
                if not branch_identify or edge.run_condition.branch_identify != branch_identify:
                    continue

            node_ids.append(edge.target_node_id)
            node_ids.extend(self._fetch_node_ids_in_reachable_branch(edge.target_node_id, branch_identify))
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
