from core.workflow.graph_engine.condition_handlers.base_handler import RunConditionHandler
from core.workflow.graph_engine.condition_handlers.branch_identify_handler import BranchIdentifyRunConditionHandler
from core.workflow.graph_engine.condition_handlers.condition_handler import ConditionRunConditionHandlerHandler
from core.workflow.graph_engine.entities.run_condition import RunCondition


class ConditionManager:
    @staticmethod
    def get_condition_handler(run_condition: RunCondition) -> RunConditionHandler:
        """
        Get condition handler

        :param run_condition: run condition
        :return: condition handler
        """
        if run_condition.type == "branch_identify":
            return BranchIdentifyRunConditionHandler(run_condition)
        else:
            return ConditionRunConditionHandlerHandler(run_condition)
