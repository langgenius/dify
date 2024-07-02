from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.graph_engine.condition_handlers.base_handler import RunConditionHandler


class BranchIdentifyRunConditionHandler(RunConditionHandler):

    def check(self,
              graph_node: "GraphNode",
              graph_runtime_state: "GraphRuntimeState",
              predecessor_node_result: NodeRunResult) -> bool:
        """
        Check if the condition can be executed

        :param graph_node: graph node
        :param graph_runtime_state: graph runtime state
        :param predecessor_node_result: predecessor node result
        :return: bool
        """
        if not self.condition.branch_identify:
            raise Exception("Branch identify is required")

        if not predecessor_node_result.edge_source_handle:
            return False

        return self.condition.branch_identify == predecessor_node_result.edge_source_handle
