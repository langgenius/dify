from core.workflow.entities import GraphInitParams, RunCondition
from core.workflow.graph import Graph
from core.workflow.graph_engine.condition_handlers.base_handler import RunConditionHandler
from core.workflow.graph_engine.condition_handlers.branch_identify_handler import BranchIdentifyRunConditionHandler
from core.workflow.graph_engine.condition_handlers.condition_handler import ConditionRunConditionHandlerHandler


class ConditionManager:
    @staticmethod
    def get_condition_handler(
        init_params: GraphInitParams, graph: Graph, run_condition: RunCondition
    ) -> RunConditionHandler:
        """
        Get condition handler

        :param init_params: init params
        :param graph: graph
        :param run_condition: run condition
        :return: condition handler
        """
        if run_condition.type == "branch_identify":
            return BranchIdentifyRunConditionHandler(init_params=init_params, graph=graph, condition=run_condition)
        else:
            return ConditionRunConditionHandlerHandler(init_params=init_params, graph=graph, condition=run_condition)
