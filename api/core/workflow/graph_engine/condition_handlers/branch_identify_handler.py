from core.workflow.graph_engine.condition_handlers.base_handler import RunConditionHandler


class BranchIdentifyRunConditionHandler(RunConditionHandler):

    def check(self,
              source_node_id: str,
              target_node_id: str,
              graph: "Graph") -> bool:
        """
        Check if the condition can be executed

        :param source_node_id: source node id
        :param target_node_id: target node id
        :param graph: graph
        :return: bool
        """
        if not self.condition.branch_identify:
            raise Exception("Branch identify is required")

        run_state = graph.run_state
        node_route_result = run_state.node_route_results.get(source_node_id)
        if not node_route_result:
            return False

        if not node_route_result.edge_source_handle:
            return False

        return self.condition.branch_identify == node_route_result.edge_source_handle
