from core.workflow.graph_engine.condition_handlers.base_handler import RunConditionHandler
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.utils.condition.processor import ConditionProcessor


class ConditionRunConditionHandlerHandler(RunConditionHandler):
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
        if not self.condition.conditions:
            return True

        # process condition
        condition_processor = ConditionProcessor()
        input_conditions, group_result = condition_processor.process_conditions(
            variable_pool=graph_runtime_state.variable_pool,
            conditions=self.condition.conditions
        )

        # Apply the logical operator for the current case
        compare_result = all(group_result)

        return compare_result
