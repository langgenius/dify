from abc import ABC, abstractmethod

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.graph_engine.entities.run_condition import RunCondition


class RunConditionHandler(ABC):
    def __init__(self, condition: RunCondition):
        self.condition = condition

    @abstractmethod
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
        raise NotImplementedError
