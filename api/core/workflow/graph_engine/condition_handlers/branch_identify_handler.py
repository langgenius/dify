from core.workflow.graph_engine.condition_handlers.base_handler import RunConditionHandler
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState


class BranchIdentifyRunConditionHandler(RunConditionHandler):

    def check(self,
              graph_runtime_state: GraphRuntimeState,
              source_node_id: str,
              target_node_id: str) -> bool:
        """
        Check if the condition can be executed

        :param graph_runtime_state: graph runtime state
        :param source_node_id: source node id
        :param target_node_id: target node id
        :return: bool
        """
        if not self.condition.branch_identify:
            raise Exception("Branch identify is required")

        node_route_state = graph_runtime_state.node_run_state.node_state_mapping.get(source_node_id)
        if not node_route_state:
            return False

        run_result = node_route_state.node_run_result
        if not run_result:
            return False

        if not run_result.edge_source_handle:
            return False

        return self.condition.branch_identify == run_result.edge_source_handle
