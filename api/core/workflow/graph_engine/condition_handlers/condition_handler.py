from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.graph_engine.condition_handlers.base_handler import RunConditionHandler
from core.workflow.utils.condition.processor import ConditionProcessor


class ConditionRunConditionHandlerHandler(RunConditionHandler):
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
        if not self.condition.conditions:
            return True

        # process condition
        condition_processor = ConditionProcessor()
        compare_result, _ = condition_processor.process(
            variable_pool=graph_runtime_state.variable_pool,
            logical_operator="and",
            conditions=self.condition.conditions
        )

        return compare_result

