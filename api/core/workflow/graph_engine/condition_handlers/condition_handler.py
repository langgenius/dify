from core.workflow.graph_engine.condition_handlers.base_handler import RunConditionHandler
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.graph_engine.entities.runtime_route_state import RouteNodeState
from core.workflow.utils.condition.processor import ConditionProcessor


class ConditionRunConditionHandlerHandler(RunConditionHandler):
    def check(self, graph_runtime_state: GraphRuntimeState, previous_route_node_state: RouteNodeState) -> bool:
        """
        Check if the condition can be executed

        :param graph_runtime_state: graph runtime state
        :param previous_route_node_state: previous route node state
        :return: bool
        """
        if not self.condition.conditions:
            return True

        # process condition
        condition_processor = ConditionProcessor()
        _, _, final_result = condition_processor.process_conditions(
            variable_pool=graph_runtime_state.variable_pool,
            conditions=self.condition.conditions,
            operator="and",
        )

        return final_result
