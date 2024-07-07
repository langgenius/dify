from abc import ABC, abstractmethod

from core.workflow.graph_engine.entities.run_condition import RunCondition


class RunConditionHandler(ABC):
    def __init__(self, condition: RunCondition):
        self.condition = condition

    @abstractmethod
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
        raise NotImplementedError
