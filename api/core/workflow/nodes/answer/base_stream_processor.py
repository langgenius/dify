import logging
from abc import ABC, abstractmethod
from collections.abc import Generator
from typing import Optional

from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine.entities.event import GraphEngineEvent, NodeRunExceptionEvent, NodeRunSucceededEvent
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.runtime_route_state import RuntimeRouteState

logger = logging.getLogger(__name__)


class StreamProcessor(ABC):
    def __init__(self, graph: Graph, variable_pool: VariablePool, node_run_state: RuntimeRouteState) -> None:
        self.graph = graph
        self.variable_pool = variable_pool
        self.node_run_state = node_run_state
        self.rest_node_ids = graph.node_ids.copy()

    @abstractmethod
    def process(self, generator: Generator[GraphEngineEvent, None, None]) -> Generator[GraphEngineEvent, None, None]:
        raise NotImplementedError

    def _remove_unreachable_nodes(self, event: NodeRunSucceededEvent | NodeRunExceptionEvent) -> None:
        """
        Prunes unreachable branches from the `rest_node_ids` list after a branch node has executed.

        This method implements a conservative, non-recursive pruning strategy to prevent a critical bug
        where the pruning process would incorrectly "spread" across join points (nodes with multiple inputs)
        and erroneously remove shared downstream nodes that should have been preserved.

        By only removing the immediate first node of each determined unreachable branch, we ensure that
        the integrity of shared paths in complex graph topologies is maintained.
        """
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
                    # if the condition edge in parallel, and the target node is not in parallel, we should not remove it
                    # Issues: #13626
                    if (
                        finished_node_id in self.graph.node_parallel_mapping
                        and edge.target_node_id not in self.graph.node_parallel_mapping
                    ):
                        continue
                    unreachable_first_node_ids.append(edge.target_node_id)

            # Instead of recursively removing the entire unreachable branch,
            # which can cause issues with complex join points,
            # we will only remove the immediate first node of the unreachable branch.
            # This prevents the removal logic from incorrectly pruning shared paths downstream.
            for node_id in list(set(unreachable_first_node_ids) - set(reachable_node_ids)):
                if node_id in self.rest_node_ids:
                    self.rest_node_ids.remove(node_id)

    def _fetch_node_ids_in_reachable_branch(self, node_id: str, branch_identify: Optional[str] = None) -> list[str]:
        if node_id not in self.rest_node_ids:
            self.rest_node_ids.append(node_id)
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

        if node_id in reachable_node_ids:
            return

        self.rest_node_ids.remove(node_id)
        self.rest_node_ids.extend(set(reachable_node_ids) - set(self.rest_node_ids))

        for edge in self.graph.edge_mapping.get(node_id, []):
            if edge.target_node_id in reachable_node_ids:
                continue

            self._remove_node_ids_in_unreachable_branch(edge.target_node_id, reachable_node_ids)
