from core.workflow.graph_engine.condition_handlers.base_handler import RunConditionHandler
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.graph_engine.entities.runtime_route_state import RouteNodeState


class BranchIdentifyRunConditionHandler(RunConditionHandler):
    def check(self, graph_runtime_state: GraphRuntimeState, previous_route_node_state: RouteNodeState) -> bool:
        """
        Check if the condition can be executed

        :param graph_runtime_state: graph runtime state
        :param previous_route_node_state: previous route node state
        :return: bool
        """
        if not self.condition.branch_identify:
            raise Exception("Branch identify is required")

        run_result = previous_route_node_state.node_run_result
        if not run_result:
            return False

        if not run_result.edge_source_handle:
            return False

        return self.condition.branch_identify == run_result.edge_source_handle
